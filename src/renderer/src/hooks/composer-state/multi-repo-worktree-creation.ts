import { toast } from 'sonner'
import type { Repo } from '../../../../shared/repo-types'
import type { CreateWorktreeResult } from '../../../../shared/worktree/create-types'
import type { WorkspaceStatus } from '../../../../shared/worktree/types'
import type { WorkspaceSource } from '../../../../shared/workspace-source'
import { getRepoExecutionHostId } from '../../../../shared/execution-host'
import { isGitRepoKind } from '../../../../shared/repo-kind'
import { agentSupportsAddDir } from '../../../../shared/agent-add-dir-args'
import { branchName as stripBranchRef } from '@/lib/git-utils'
import {
  formatWorkspaceCreateError,
  getWorkspaceCreateErrorToastMessage
} from '@/lib/workspace-create-error-format'
import { translate } from '@/i18n/i18n'
import type { PreparedQuickSubmit } from './composer-submit-model'

/** What the composer submits for its "Also create in" row. */
export type ComposerCompanionSubmit = {
  repoIds: readonly string[]
  grantAgentAccess: boolean
}

export type CompanionSetupResolution = {
  decision: 'run' | 'skip'
  /** Setup was skipped only because it needs a choice or a trust approval nobody is asked for. */
  needsUserDecision: boolean
}

export type CompanionWorktreeRequest = {
  name: string
  displayName?: string
  displayNameKind?: 'generated' | 'user'
  nameWasGenerated?: boolean
  branchNameOverride?: string
  setupDecision: 'run' | 'skip'
  workspaceStatus?: WorkspaceStatus
  telemetrySource?: WorkspaceSource
}

export type CompanionWorktreeOutcome =
  | {
      status: 'created'
      repo: Repo
      worktreeId: string
      path: string
      branch: string
      /** The pinned branch this companion asked for, set only when it landed on another one. */
      expectedBranch?: string
      setupNeedsUserDecision: boolean
    }
  | { status: 'failed'; repo: Repo; error: string }

export type CompanionCreationDeps = {
  /** Awaits the real create (each repo's own base branch, no agent) and returns its result. */
  createWorktree: (repo: Repo, request: CompanionWorktreeRequest) => Promise<CreateWorktreeResult>
  resolveSetup: (repo: Repo) => Promise<CompanionSetupResolution>
  /** Starts setup / default-tab terminals in the background; must not throw. */
  seedTerminals: (result: CreateWorktreeResult) => void
}

type CompanionNaming = Omit<CompanionWorktreeRequest, 'setupDecision' | 'branchNameOverride'>

/**
 * Creates each companion worktree in order, one at a time, so every repo gets the same branch:
 * an explicit name is pinned everywhere, otherwise the first created branch becomes the pin.
 * A failure is recorded and the rest still run; cancelling stops it only before a companion exists.
 */
export async function createCompanionWorktrees(args: {
  companions: readonly Repo[]
  naming: CompanionNaming
  branchNameOverride: string | undefined
  isCancelled: () => boolean
  deps: CompanionCreationDeps
}): Promise<{ outcomes: CompanionWorktreeOutcome[]; branchName: string | undefined }> {
  let pinnedBranch = args.branchNameOverride
  const outcomes: CompanionWorktreeOutcome[] = []
  // Why: once a companion exists the submit is committed; a late dismissal must not split it.
  const cancelledBeforeAnyCompanion = (): boolean =>
    args.isCancelled() && !outcomes.some((outcome) => outcome.status === 'created')
  for (const repo of args.companions) {
    if (cancelledBeforeAnyCompanion()) {
      break
    }
    try {
      const setup = await args.deps.resolveSetup(repo)
      // Why re-check: resolveSetup can await a remote hooks read, long enough for a dismissal.
      if (cancelledBeforeAnyCompanion()) {
        break
      }
      const requestedBranch = pinnedBranch
      const result = await args.deps.createWorktree(repo, {
        ...args.naming,
        setupDecision: setup.decision,
        ...(requestedBranch ? { branchNameOverride: requestedBranch } : {})
      })
      const branch = stripBranchRef(result.worktree.branch)
      pinnedBranch ??= branch || undefined
      outcomes.push({
        status: 'created',
        repo,
        worktreeId: result.worktree.id,
        path: result.worktree.path,
        branch,
        // Why: a pinned branch checked out elsewhere in that repo comes back suffixed (X-2).
        ...(requestedBranch && branch !== requestedBranch
          ? { expectedBranch: requestedBranch }
          : {}),
        setupNeedsUserDecision: setup.needsUserDecision
      })
      args.deps.seedTerminals(result)
    } catch (error) {
      outcomes.push({
        status: 'failed',
        repo,
        error: getWorkspaceCreateErrorToastMessage(formatWorkspaceCreateError(error))
      })
    }
  }
  return { outcomes, branchName: pinnedBranch }
}

export type CompanionOutcomeSummary = {
  kind: 'error' | 'warning'
  title: string
  description: string
}

function summaryTitle(hasFailures: boolean, hasOffBranch: boolean): string {
  if (hasFailures) {
    return translate(
      'auto.hooks.useComposerState.companionCreateFailed',
      'Some companion worktrees were not created'
    )
  }
  if (hasOffBranch) {
    return translate(
      'auto.hooks.useComposerState.companionBranchMismatchTitle',
      'Some companion worktrees are on a different branch'
    )
  }
  return translate(
    'auto.hooks.useComposerState.companionSetupSkippedTitle',
    'Companion worktrees created without setup'
  )
}

/**
 * One toast for everything the user should know: failed repos first, then companions off the
 * shared branch, then skipped setups.
 */
export function summarizeCompanionOutcomes(
  outcomes: readonly CompanionWorktreeOutcome[]
): CompanionOutcomeSummary | null {
  const failed = outcomes.flatMap((outcome) => (outcome.status === 'failed' ? [outcome] : []))
  const offBranch = outcomes.flatMap((outcome) =>
    outcome.status === 'created' && outcome.expectedBranch ? [outcome] : []
  )
  const setupSkipped = outcomes.flatMap((outcome) =>
    outcome.status === 'created' && outcome.setupNeedsUserDecision ? [outcome.repo] : []
  )
  if (failed.length === 0 && offBranch.length === 0 && setupSkipped.length === 0) {
    return null
  }
  const lines = failed.map((outcome) => `${outcome.repo.displayName}: ${outcome.error}`)
  for (const outcome of offBranch) {
    lines.push(
      translate(
        'auto.hooks.useComposerState.companionBranchMismatch',
        '{{name}} is on {{branch}} instead of {{expected}}',
        { name: outcome.repo.displayName, branch: outcome.branch, expected: outcome.expectedBranch }
      )
    )
  }
  if (setupSkipped.length > 0) {
    lines.push(
      translate(
        'auto.hooks.useComposerState.companionSetupSkipped',
        'Setup did not run in {{names}}: it needs a setup decision or script approval.',
        { names: setupSkipped.map((repo) => repo.displayName).join(', ') }
      )
    )
  }
  return {
    kind: failed.length > 0 ? 'error' : 'warning',
    title: summaryTitle(failed.length > 0, offBranch.length > 0),
    description: lines.join('\n')
  }
}

/** The selected companions that can still be created next to `primaryRepo`, in selection order. */
export function resolveCompanionRepos(
  repoIds: readonly string[],
  repos: readonly Repo[],
  primaryRepo: Repo
): Repo[] {
  const primaryHostId = getRepoExecutionHostId(primaryRepo)
  return [...new Set(repoIds)].flatMap((repoId) => {
    const repo = repos.find(
      (candidate) => candidate.id === repoId && getRepoExecutionHostId(candidate) === primaryHostId
    )
    return repo && repo.id !== primaryRepo.id && isGitRepoKind(repo) ? [repo] : []
  })
}

export type CompanionPrimarySubmit = Pick<
  PreparedQuickSubmit,
  | 'agent'
  | 'workspaceName'
  | 'createDisplayName'
  | 'nameIsAutoManaged'
  | 'nameWasGenerated'
  | 'effectiveBranchNameOverride'
  | 'pendingFirstAgentMessageRename'
>

/** A companion worktree that exists, named the way a cleanup notice shows it. */
export type CreatedCompanionWorktree = {
  repoName: string
  branch: string
}

export type CompanionLaunchPlan = {
  /** Real companion worktree paths the primary agent gets via `--add-dir`. */
  addDirPaths: string[]
  branchNameOverride: string | undefined
  pendingFirstAgentMessageRename: boolean
  /** Companions created for this submit; any at all commits the primary to follow them. */
  createdCompanions: CreatedCompanionWorktree[]
}

/**
 * Runs the companions before the primary exists, then returns what the primary's create needs:
 * the shared branch to pin and the paths to hand its agent.
 */
export async function prepareCompanionWorktrees(args: {
  submit: ComposerCompanionSubmit | undefined
  repos: readonly Repo[]
  primaryRepo: Repo
  /** The primary's prepared quick submit: its agent, names and branch decisions. */
  primary: CompanionPrimarySubmit
  /** False when the agent runs somewhere the companion paths do not exist (an ephemeral VM). */
  agentCanReachCompanions: boolean
  /** False when the primary's launch route reads no CLI args (a structured native chat). */
  launchReadsAgentArgs: boolean
  workspaceStatus?: WorkspaceStatus
  telemetrySource?: WorkspaceSource
  isCancelled: () => boolean
  deps: CompanionCreationDeps
}): Promise<CompanionLaunchPlan> {
  const { primary } = args
  const unchanged: CompanionLaunchPlan = {
    addDirPaths: [],
    branchNameOverride: primary.effectiveBranchNameOverride,
    pendingFirstAgentMessageRename: primary.pendingFirstAgentMessageRename,
    createdCompanions: []
  }
  const companions = args.submit
    ? resolveCompanionRepos(args.submit.repoIds, args.repos, args.primaryRepo)
    : []
  if (companions.length === 0) {
    return unchanged
  }
  const { outcomes, branchName } = await createCompanionWorktrees({
    companions,
    naming: {
      name: primary.workspaceName,
      displayName: primary.createDisplayName,
      displayNameKind: primary.createDisplayName
        ? primary.nameIsAutoManaged
          ? 'generated'
          : 'user'
        : undefined,
      nameWasGenerated: primary.nameWasGenerated,
      workspaceStatus: args.workspaceStatus,
      telemetrySource: args.telemetrySource
    },
    branchNameOverride: primary.effectiveBranchNameOverride,
    isCancelled: args.isCancelled,
    deps: args.deps
  })
  const summary = summarizeCompanionOutcomes(outcomes)
  if (summary) {
    toast[summary.kind](summary.title, { description: summary.description })
  }
  const grantAccess =
    args.submit?.grantAgentAccess === true &&
    args.agentCanReachCompanions &&
    args.launchReadsAgentArgs &&
    agentSupportsAddDir(primary.agent)
  const created = outcomes.flatMap((outcome) => (outcome.status === 'created' ? [outcome] : []))
  return {
    addDirPaths: grantAccess ? created.map((outcome) => outcome.path) : [],
    branchNameOverride: branchName,
    // Why: a later rename from the first agent message would split the primary off the shared branch.
    pendingFirstAgentMessageRename: branchName ? false : primary.pendingFirstAgentMessageRename,
    createdCompanions: created.map((outcome) => ({
      repoName: outcome.repo.displayName,
      branch: outcome.branch
    }))
  }
}
