import type { Repo } from '../../../../shared/repo-types'
import { getRepoExecutionHostId, type ExecutionHostId } from '../../../../shared/execution-host'
import { useAppStore } from '@/store'
import { sourceControlLaunchAppliesAgentArgs } from '@/components/right-sidebar/source-control-launch-agent-args-applicability'
import { getSetupConfig } from '@/lib/new-workspace'
import { getSettingsForRepoRuntimeOwner } from '@/lib/repo-runtime-owner'
import { checkRuntimeHooks } from '@/runtime/runtime-hooks-client'
import {
  isHookScriptContentTrusted,
  resolveHookTrustContent
} from '@/lib/hook-script-trust-content'
import { ensureWorktreeHasInitialTerminal } from '@/lib/worktree-initial-terminal-seeding'
import {
  prepareCompanionWorktrees,
  type CompanionCreationDeps,
  type CompanionLaunchPlan,
  type CompanionSetupResolution
} from './multi-repo-worktree-creation'

const SKIP_SETUP: CompanionSetupResolution = { decision: 'skip', needsUserDecision: false }

/**
 * The composer's setup rules for one companion, minus every prompt: a repo that would ask
 * (policy "ask", or setup text not yet trusted) gets setup skipped and is flagged instead.
 */
export async function resolveCompanionSetup(repo: Repo): Promise<CompanionSetupResolution> {
  const policy = repo.hookSettings?.setupRunPolicy ?? 'run-by-default'
  if (policy === 'skip-by-default') {
    return SKIP_SETUP
  }
  const state = useAppStore.getState()
  const hostId = getRepoExecutionHostId(repo)
  const hooks = await checkRuntimeHooks(
    getSettingsForRepoRuntimeOwner(state, repo.id),
    repo.id,
    hostId
  ).then(
    (result) => result.hooks,
    () => undefined
  )
  // Why skip on a failed check: setup the composer cannot inspect must not run unseen.
  if (hooks === undefined || !getSetupConfig(repo, hooks)) {
    return SKIP_SETUP
  }
  if (policy === 'ask') {
    return { decision: 'skip', needsUserDecision: true }
  }
  const trust = await resolveHookTrustContent(state, repo.id, 'setup', hostId)
  if (trust.kind === 'decided') {
    return { decision: trust.decision, needsUserDecision: false }
  }
  return (await isHookScriptContentTrusted(state, repo.id, 'setup', trust.scriptContent))
    ? { decision: 'run', needsUserDecision: false }
    : { decision: 'skip', needsUserDecision: true }
}

export const STORE_COMPANION_CREATION_DEPS: CompanionCreationDeps = {
  createWorktree: (repo, request) =>
    useAppStore.getState().createWorktree(
      repo.id,
      request.name,
      // Why undefined: each companion branches from its own default base (develop or main).
      undefined,
      request.setupDecision,
      undefined,
      request.telemetrySource,
      request.displayName,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      request.branchNameOverride,
      request.workspaceStatus,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        ...(request.nameWasGenerated ? { nameWasGenerated: true } : {}),
        ...(request.displayNameKind ? { displayNameKind: request.displayNameKind } : {})
      }
    ),
  resolveSetup: resolveCompanionSetup,
  seedTerminals: (result) => {
    if (!result.setup && !result.defaultTabs) {
      return
    }
    try {
      // Why not activate: the primary owns focus; companions only start their setup in the background.
      ensureWorktreeHasInitialTerminal(
        useAppStore.getState(),
        result.worktree.id,
        undefined,
        result.setup,
        undefined,
        result.defaultTabs,
        { activateCreatedTabs: false }
      )
    } catch (error) {
      console.error('companion worktree: setup terminal seeding failed', result.worktree.id, error)
    }
  }
}

/** The composer's entry point: companions against the live store, then the primary's launch plan. */
export function prepareStoreCompanionWorktrees(
  args: Omit<
    Parameters<typeof prepareCompanionWorktrees>[0],
    'repos' | 'deps' | 'launchReadsAgentArgs'
  > & {
    /** The host the primary's agent launch route is decided for. */
    launchHostId: ExecutionHostId | undefined
  }
): Promise<CompanionLaunchPlan> {
  const { launchHostId, ...companionArgs } = args
  return prepareCompanionWorktrees({
    ...companionArgs,
    repos: useAppStore.getState().repos,
    // Why: the rule that shows the composer's access checkbox; structured chat drops `--add-dir`.
    launchReadsAgentArgs: sourceControlLaunchAppliesAgentArgs({
      agent: args.primary.agent,
      repoId: args.primaryRepo.id,
      ...(launchHostId ? { executionHostId: launchHostId } : {})
    }),
    deps: STORE_COMPANION_CREATION_DEPS
  })
}
