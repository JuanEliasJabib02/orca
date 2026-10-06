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
import type { PreparedQuickSubmit } from './composer-submit-model'
import {
  resolveCompanionBaseBranch,
  resolvePrimaryBaseRef,
  type CompanionBaseFallback
} from './companion-base-ref'
import { summarizeCompanionOutcomes } from './companion-outcome-summary'

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
  /** The primary's base, set only when this repo has it; otherwise the repo's own default. */
  baseBranch?: string
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
      /** Set when this companion could not use the primary's base and took its own default. */
      baseFallback?: CompanionBaseFallback
      setupNeedsUserDecision: boolean
    }
  | { status: 'failed'; repo: Repo; error: string }

export type CompanionCreationDeps = {
  /** Awaits the real create (no agent) and returns its result. */
  createWorktree: (repo: Repo, request: CompanionWorktreeRequest) => Promise<CreateWorktreeResult>
  resolveSetup: (repo: Repo) => Promise<CompanionSetupResolution>
  /** The repo's detected default base, which its picker shows when none is configured; may reject. */
  resolveDefaultBaseRef: (repo: Repo) => Promise<string | null>
  /** Whether `baseRef` exists in `repo`, asked on that repo's execution host; may reject. */
  hasBaseRef: (repo: Repo, baseRef: string) => Promise<boolean>
  /** Starts setup / default-tab terminals in the background; must not throw. */
  seedTerminals: (result: CreateWorktreeResult) => void
}

type CompanionNaming = Omit<
  CompanionWorktreeRequest,
  'setupDecision' | 'branchNameOverride' | 'baseBranch'
>

/**
 * Creates each companion worktree in order, one at a time, so every repo gets the same branch:
 * an explicit name is pinned everywhere, otherwise the first created branch becomes the pin.
 * Each one branches from the primary's base when it has that ref, otherwise from its own default.
 * A failure is recorded and the rest still run; cancelling stops it only before a companion exists.
 */
export async function createCompanionWorktrees(args: {
  companions: readonly Repo[]
  naming: CompanionNaming
  branchNameOverride: string | undefined
  /** The primary's effective base; undefined leaves every companion on its own default. */
  baseBranch?: string
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
      const [setup, base] = await Promise.all([
        args.deps.resolveSetup(repo),
        resolveCompanionBaseBranch(repo, args.baseBranch, args.deps.hasBaseRef)
      ])
      // Why re-check: both lookups can await a remote host, long enough for a dismissal.
      if (cancelledBeforeAnyCompanion()) {
        break
      }
      const requestedBranch = pinnedBranch
      const result = await args.deps.createWorktree(repo, {
        ...args.naming,
        setupDecision: setup.decision,
        ...(requestedBranch ? { branchNameOverride: requestedBranch } : {}),
        ...(base.baseBranch ? { baseBranch: base.baseBranch } : {})
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
        ...(base.fallback ? { baseFallback: base.fallback } : {}),
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
  | 'submitBaseBranch'
  | 'submitBaseIsPullRequestHead'
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
  /** The primary's prepared quick submit: its agent, names, branch and base decisions. */
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
  // Why the shown default too: with nothing selected the primary still branches from what its picker shows.
  const baseBranch = await resolvePrimaryBaseRef({
    // Why: a PR head exists only in the primary's repo; companions share the primary's default base instead.
    explicitBaseBranch: primary.submitBaseIsPullRequestHead ? undefined : primary.submitBaseBranch,
    primaryRepo: args.primaryRepo,
    resolveDefaultBaseRef: args.deps.resolveDefaultBaseRef
  })
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
    baseBranch,
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
