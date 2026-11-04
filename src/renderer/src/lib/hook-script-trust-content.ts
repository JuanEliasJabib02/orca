import type { AppState } from '@/store/types'
import type { OrcaHooks } from '../../../shared/orca-yaml-hook-types'
import { resolveHookCommandSourcePolicy } from '../../../shared/hook-command-source-policy'
import { getSetupTrustContent } from '../../../shared/orca-hook-setup-config'
import { canUseRepoWideTrust } from '../../../shared/orca-hook-trust-entries'
import { hashOrcaHookScript, type OrcaHookScriptKind } from './orca-hook-trust'
import { checkRuntimeHooks, readRuntimeIssueCommand } from '@/runtime/runtime-hooks-client'
import {
  getRepoExecutionHostId,
  toRuntimeExecutionHostId,
  type ExecutionHostId
} from '../../../shared/execution-host'

// Why its own module: the trust prompt (ensure-hooks-confirmed) and prompt-free callers such as
// companion worktree creation must read the same script text and the same approvals.

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

/** Inspect on the captured runtime owner, then explicit host, then repo owner; never substitute focused host, including server-owned SSH repos. */
export function hookRepoOwnerHostId(
  state: AppState,
  repoId: string,
  hostId?: ExecutionHostId,
  runtimeOwnerEnvironmentId?: string | null
): ExecutionHostId {
  const ownerEnvironmentId = runtimeOwnerEnvironmentId?.trim()
  if (ownerEnvironmentId) {
    return toRuntimeExecutionHostId(ownerEnvironmentId)
  }
  const rows = hostId ? [] : state.repos.filter((entry) => entry.id === repoId)
  // Why: with the id on two hosts, trusting one row's script could run the other's unseen.
  if (rows.length > 1) {
    throw new Error('The project exists on more than one host.')
  }
  const repo = rows[0] ?? null
  const ownerHostId = hostId ?? (repo ? getRepoExecutionHostId(repo) : null)
  if (!ownerHostId) {
    throw new Error('The project host is unknown.')
  }
  return ownerHostId
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
  if (canUseRepoWideTrust(state.trustedOrcaHooks, state.repos, repoId)) {
    return { kind: 'decided', decision: 'run' }
  }
  try {
    if (scriptKind === 'issueCommand') {
      // Only shared orca.yaml needs repo trust; user-owned overrides do not. Pass hostId to disambiguate same-ID repos, as checkRuntimeHooks does.
      // A launch is a user act: it may start the repo's stopped WSL distro.
      const result = await readRuntimeIssueCommand(
        hookRepoOwnerHostId(state, repoId, hostId, runtimeOwnerEnvironmentId),
        repoId,
        { wakeWslDistro: true }
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
      hookRepoOwnerHostId(state, repoId, hostId, runtimeOwnerEnvironmentId),
      repoId
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
  if (canUseRepoWideTrust(state.trustedOrcaHooks, state.repos, repoId) || !scriptContent) {
    return true
  }
  const contentHash = await hashOrcaHookScript(scriptContent)
  return state.trustedOrcaHooks[repoId]?.[scriptKind]?.contentHash === contentHash
}
