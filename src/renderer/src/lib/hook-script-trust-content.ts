import type { AppState } from '@/store/types'
import type { OrcaHooks } from '../../../shared/orca-yaml-hook-types'
import { resolveHookCommandSourcePolicy } from '../../../shared/hook-command-source-policy'
import { hashOrcaHookScript, type OrcaHookScriptKind } from './orca-hook-trust'
import { checkRuntimeHooks, readRuntimeIssueCommand } from '@/runtime/runtime-hooks-client'
import { getRuntimeEnvironmentIdForRepo } from './repo-runtime-owner'
import {
  getRepoExecutionHostId,
  parseExecutionHostId,
  type ExecutionHostId
} from '../../../shared/execution-host'

// Why its own module: the trust prompt (ensure-hooks-confirmed) and prompt-free callers such as
// companion worktree creation must read the same script text and the same approvals.

function getSetupTrustContent(yamlHooks: OrcaHooks | null): string {
  const defaultTabCommands = (yamlHooks?.defaultTabs ?? [])
    .map((tab, index) => {
      const command = tab.command?.trim()
      if (!command) {
        return null
      }
      const label = tab.title ? ` ${tab.title}` : ''
      return `# defaultTabs[${index + 1}]${label}\n${command}`
    })
    .filter((entry): entry is string => entry !== null)
  return [yamlHooks?.scripts?.setup?.trim(), ...defaultTabCommands].filter(Boolean).join('\n\n')
}

function getVmRecipeTrustContent(yamlHooks: OrcaHooks | null): string {
  return (yamlHooks?.environmentRecipes ?? [])
    .map((recipe) =>
      [
        `# environmentRecipes.${recipe.id}`,
        `name: ${recipe.name}`,
        recipe.description ? `description: ${recipe.description}` : null,
        `create: ${recipe.create}`,
        recipe.suspend ? `suspend: ${recipe.suspend}` : null,
        recipe.resume ? `resume: ${recipe.resume}` : null,
        recipe.destroyDisabled
          ? 'destroy: none'
          : recipe.destroy
            ? `destroy: ${recipe.destroy}`
            : null
      ]
        .filter((entry): entry is string => entry !== null)
        .join('\n')
    )
    .join('\n\n')
}

export function findHookRepo(state: AppState, repoId: string, hostId?: ExecutionHostId) {
  return hostId
    ? state.repos.find((repo) => repo.id === repoId && getRepoExecutionHostId(repo) === hostId)
    : state.repos.find((repo) => repo.id === repoId)
}

export function settingsForHookRepoOwner(
  state: AppState,
  repoId: string,
  hostId?: ExecutionHostId,
  runtimeOwnerEnvironmentId?: string | null
): AppState['settings'] {
  const parsedHost = hostId ? parseExecutionHostId(hostId) : null
  const runtimeEnvironmentId =
    runtimeOwnerEnvironmentId?.trim() ||
    (hostId
      ? parsedHost?.kind === 'runtime'
        ? parsedHost.environmentId
        : null
      : getRuntimeEnvironmentIdForRepo(state, repoId))
  // Why: hook inspection must follow the repo owner. SSH/local repos execute
  // through desktop IPC, while runtime repos may differ from the focused host.
  return state.settings
    ? { ...state.settings, activeRuntimeEnvironmentId: runtimeEnvironmentId }
    : ({ activeRuntimeEnvironmentId: runtimeEnvironmentId } as AppState['settings'])
}

export function canUseRepoWideTrust(state: AppState, repoId: string): boolean {
  const hasDuplicateRepoId = state.repos.filter((repo) => repo.id === repoId).length > 1
  return Boolean(state.trustedOrcaHooks[repoId]?.all) && !hasDuplicateRepoId
}

export type HookTrustContent =
  | { kind: 'decided'; decision: 'run' | 'skip' }
  | { kind: 'content'; scriptContent: string }

/** Everything trust needs short of the prompt: a verdict, or the script text still to approve. */
export async function resolveHookTrustContent(
  state: AppState,
  repoId: string,
  scriptKind: OrcaHookScriptKind,
  hostId?: ExecutionHostId,
  runtimeOwnerEnvironmentId?: string | null
): Promise<HookTrustContent> {
  if (canUseRepoWideTrust(state, repoId)) {
    return { kind: 'decided', decision: 'run' }
  }
  try {
    if (scriptKind === 'issueCommand') {
      // Local overrides are user-owned; only shared orca.yaml commands need repo trust.
      // Why: hostId disambiguates duplicate repo ids on the local IPC path,
      // matching the checkRuntimeHooks call below.
      const result = await readRuntimeIssueCommand(
        settingsForHookRepoOwner(state, repoId, hostId, runtimeOwnerEnvironmentId),
        repoId,
        hostId
      )
      if (result.source === 'local') {
        return { kind: 'decided', decision: 'run' }
      }
      if (result.status === 'error') {
        return { kind: 'decided', decision: 'skip' }
      }
      if (result.source !== 'shared') {
        return { kind: 'decided', decision: 'run' }
      }
      return { kind: 'content', scriptContent: (result.sharedContent ?? '').trim() }
    }
    const repo = findHookRepo(state, repoId, hostId)
    const localScript = repo?.hookSettings?.scripts?.[scriptKind]?.trim()
    const sourcePolicy = resolveHookCommandSourcePolicy(repo?.hookSettings?.commandSourcePolicy, {
      hasLocalScript: Boolean(localScript)
    })
    if (sourcePolicy === 'local-only') {
      return { kind: 'decided', decision: 'run' }
    }
    const result = await checkRuntimeHooks(
      settingsForHookRepoOwner(state, repoId, hostId, runtimeOwnerEnvironmentId),
      repoId,
      hostId
    )
    if (result.status === 'error') {
      return { kind: 'decided', decision: 'skip' }
    }
    const yamlHooks = (result.hooks as OrcaHooks | null) ?? null
    return {
      kind: 'content',
      scriptContent:
        scriptKind === 'setup'
          ? getSetupTrustContent(yamlHooks)
          : scriptKind === 'vmRecipe'
            ? getVmRecipeTrustContent(yamlHooks)
            : (yamlHooks?.scripts?.[scriptKind] ?? '').trim()
    }
  } catch {
    // Fail closed: if we cannot inspect the script, we cannot trust it.
    return { kind: 'decided', decision: 'skip' }
  }
}

/** Whether this exact script text was already approved, without asking. */
export async function isHookScriptContentTrusted(
  state: AppState,
  repoId: string,
  scriptKind: OrcaHookScriptKind,
  scriptContent: string
): Promise<boolean> {
  if (canUseRepoWideTrust(state, repoId) || !scriptContent) {
    return true
  }
  const contentHash = await hashOrcaHookScript(scriptContent)
  return state.trustedOrcaHooks[repoId]?.[scriptKind]?.contentHash === contentHash
}
