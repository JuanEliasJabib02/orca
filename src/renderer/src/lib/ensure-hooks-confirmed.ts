import type { AppState } from '@/store/types'
import { hashOrcaHookScript, type OrcaHookScriptKind } from './orca-hook-trust'
import {
  readRuntimeIssueCommand,
  type IssueCommandReadResult
} from '@/runtime/runtime-hooks-client'
import { MODAL_DISMISSED_KEY } from '@/store/slices/modal-slot-dismissal'
import type { ExecutionHostId } from '../../../shared/execution-host'
import {
  canUseRepoWideTrust,
  findHookRepo,
  resolveHookTrustContent,
  settingsForHookRepoOwner
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
  isCancelled: () => boolean = NEVER_CANCEL_TRUST_CHECK
): Promise<'run' | 'skip'> {
  if (isCancelled()) {
    return 'skip'
  }
  if (canUseRepoWideTrust(state, repoId) || !scriptContent) {
    return 'run'
  }

  const contentHash = await hashOrcaHookScript(scriptContent)
  if (isCancelled()) {
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
      resolve(decision)
    }
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
    result = await readRuntimeIssueCommand(
      settingsForHookRepoOwner(state, repoId, hostId),
      repoId,
      hostId
    )
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
  // Why a getter: a caller that queues behind an earlier prompt must see the trust it recorded.
  stateOrGetter: AppState | (() => AppState),
  repoId: string,
  scriptKind: HookScriptKind,
  hostId?: ExecutionHostId,
  runtimeOwnerEnvironmentId?: string | null,
  isCancelled: () => boolean = NEVER_CANCEL_TRUST_CHECK
): Promise<'run' | 'skip'> {
  return enqueueTrustPrompt(async () => {
    if (isCancelled()) {
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
      isCancelled
    )
  })
}
