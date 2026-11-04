import type { AppState } from '@/store/types'
import { canUseRepoWideTrust } from '../../../shared/orca-hook-trust-entries'
import { hashOrcaHookScript, type OrcaHookScriptKind } from './orca-hook-trust'
import {
  readRuntimeIssueCommand,
  type IssueCommandReadResult
} from '@/runtime/runtime-hooks-client'
import { MODAL_DISMISSED_KEY } from '@/store/slices/modal-slot-dismissal'
import type { ExecutionHostId } from '../../../shared/execution-host'
import {
  findHookRepo,
  hookRepoOwnerHostId,
  resolveHookTrustContent
} from './hook-script-trust-content'

export type HookScriptKind = OrcaHookScriptKind

const NEVER_CANCEL_TRUST_CHECK = (): boolean => false

// Serialize the singleton modal callback so overlapping worktree actions cannot replace it.
let trustPromptChain: Promise<unknown> = Promise.resolve()

function enqueueTrustPrompt<T>(task: () => Promise<T>): Promise<T> {
  const next = trustPromptChain.then(task, task)
  trustPromptChain = next.catch(() => undefined)
  return next
}

export function __resetTrustPromptChainForTests(): void {
  trustPromptChain = Promise.resolve()
}

async function confirmScriptContent(
  state: AppState,
  repoId: string,
  scriptKind: HookScriptKind,
  scriptContent: string,
  hostId?: ExecutionHostId,
  isCancelled: () => boolean = NEVER_CANCEL_TRUST_CHECK,
  signal?: AbortSignal
): Promise<'run' | 'skip'> {
  if (isCancelled() || signal?.aborted) {
    return 'skip'
  }
  if (canUseRepoWideTrust(state.trustedOrcaHooks, state.repos, repoId) || !scriptContent) {
    return 'run'
  }

  const contentHash = await hashOrcaHookScript(scriptContent)
  if (isCancelled() || signal?.aborted) {
    return 'skip'
  }
  const existingHash = state.trustedOrcaHooks[repoId]?.[scriptKind]?.contentHash
  if (existingHash === contentHash) {
    return 'run'
  }

  const repo = findHookRepo(state, repoId, hostId)
  const repoName = repo?.displayName ?? 'this repository'
  const previouslyApproved = Boolean(existingHash)

  return new Promise<'run' | 'skip'>((resolve) => {
    let settled = false
    const settle = (decision: 'run' | 'skip'): void => {
      if (settled) {
        return
      }
      settled = true
      signal?.removeEventListener('abort', cancel)
      resolve(decision)
    }
    const cancel = (): void => {
      // Eviction settles first, so an abort can only close this prompt.
      if (settled) {
        return
      }
      settle('skip')
      state.closeModal()
    }
    signal?.addEventListener('abort', cancel, { once: true })
    state.openModal('confirm-orca-yaml-hooks', {
      repoId,
      repoName,
      scriptKind,
      scriptContent,
      contentHash,
      previouslyApproved,
      onResolve: settle,
      // Why: eviction must fail closed without stranding the singleton trust queue.
      [MODAL_DISMISSED_KEY]: () => settle('skip')
    })
  })
}

function getIssueCommandTrustContent(result: IssueCommandReadResult): string {
  if (result.source === 'local') {
    return (result.localContent ?? '').trim()
  }
  if (result.source === 'shared') {
    return (result.sharedContent ?? '').trim()
  }
  return ''
}

async function confirmIssueCommandReadResult(
  state: AppState,
  repoId: string,
  hostId: ExecutionHostId,
  result: IssueCommandReadResult,
  isCancelled: () => boolean = NEVER_CANCEL_TRUST_CHECK
): Promise<'run' | 'skip'> {
  if (isCancelled()) {
    return 'skip'
  }
  if (result.source === 'local') {
    return 'run'
  }
  if (result.status === 'error') {
    return 'skip'
  }
  return confirmScriptContent(
    state,
    repoId,
    'issueCommand',
    getIssueCommandTrustContent(result),
    hostId,
    isCancelled
  )
}

export type ConfirmedRuntimeIssueCommand = {
  result: IssueCommandReadResult
  template: string
  trustDecision: 'run' | 'skip'
}

function confirmRuntimeIssueCommandRead(
  state: AppState,
  repoId: string,
  hostId: ExecutionHostId,
  result: IssueCommandReadResult,
  isCancelled: () => boolean = NEVER_CANCEL_TRUST_CHECK
): Promise<ConfirmedRuntimeIssueCommand> {
  return enqueueTrustPrompt(async () => ({
    result,
    template: getIssueCommandTrustContent(result),
    trustDecision: await confirmIssueCommandReadResult(state, repoId, hostId, result, isCancelled)
  }))
}

export async function readAndConfirmRuntimeIssueCommand(
  state: AppState,
  repoId: string,
  hostId: ExecutionHostId,
  isCancelled: () => boolean = NEVER_CANCEL_TRUST_CHECK
): Promise<ConfirmedRuntimeIssueCommand> {
  let result: IssueCommandReadResult
  try {
    // Creating a workspace is a user act: it may start the repo's stopped WSL distro.
    result = await readRuntimeIssueCommand(hookRepoOwnerHostId(state, repoId, hostId), repoId, {
      wakeWslDistro: true
    })
  } catch {
    result = {
      status: 'error',
      localContent: null,
      sharedContent: null,
      effectiveContent: null,
      localFilePath: '',
      source: 'none'
    }
  }
  return confirmRuntimeIssueCommandRead(state, repoId, hostId, result, isCancelled)
}

export async function ensureHooksConfirmed(
  // Read current trust when dequeued so earlier prompts’ decisions apply.
  stateOrGetter: AppState | (() => AppState),
  repoId: string,
  scriptKind: HookScriptKind,
  hostId?: ExecutionHostId,
  runtimeOwnerEnvironmentId?: string | null,
  isCancelled: () => boolean = NEVER_CANCEL_TRUST_CHECK,
  signal?: AbortSignal
): Promise<'run' | 'skip'> {
  return enqueueTrustPrompt(async () => {
    if (isCancelled() || signal?.aborted) {
      return 'skip'
    }
    const state = typeof stateOrGetter === 'function' ? stateOrGetter() : stateOrGetter
    const trustContent = await resolveHookTrustContent(
      state,
      repoId,
      scriptKind,
      hostId,
      runtimeOwnerEnvironmentId
    )
    if (trustContent.kind === 'decided') {
      return trustContent.decision
    }
    return confirmScriptContent(
      state,
      repoId,
      scriptKind,
      trustContent.scriptContent,
      hostId,
      isCancelled,
      signal
    )
  })
}
