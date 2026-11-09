// Continuar on the test queue: a paused pane resumes on the Claude account with limit left, an idle
// holder is interrupted in place; both end with "continue" typed to the agent and main's settle.
import { useAppStore } from '@/store'
import type { AppState } from '@/store/types'
import { selectClaudeProviderAccount } from '@/runtime/provider-accounts/observations/runtime-provider-accounts-client'
import { TUI_AGENT_CONFIG } from '../../../shared/agent-launch/catalog/tui-agent-config'
import { normalizeAgentProviderSession } from '../../../shared/agent-session/lifecycle/agent-session-resume'
import { NATIVE_CHAT_USAGE_LIMIT_CONTINUE_MESSAGE } from '../../../shared/native-chat/native-chat-usage-limit-cut'
import type {
  SpotlightAgentStatus,
  SpotlightResumeAccountPick
} from '../../../shared/spotlight-agent-turn'
import { parsePaneKey } from '../../../shared/workspace-layout/stable-pane-id'
import { buildPaneAccountRestartStartup } from './agent-session/accounts/agent-account-restart-startup'
import { sendFollowupPromptWhenAgentReady } from './agent-followup-delivery'
import { sendBracketedPasteToRunningAgent } from './agent-paste-draft'
import {
  isClaudePaneOnAccount,
  resolveClaudePaneFolder
} from './agent-session/accounts/claude/claude-pane-account-folder'
import { claudeLaunchAccountId } from './agent-session/accounts/claude/claude-session-account-move'
import { isForeignMachineCodexPtyId } from './codex-pane-selection-lane'

/** The idle holder's Esc gets this long to stop the running turn before the message goes in. */
const ESC_SETTLE_MS = 5_000
/** The least time between the Esc and the paste, so the agent reads them as two inputs. */
const ESC_PASTE_GAP_MS = 500
/** A restarted pane gets this long to come back on its new PTY; main's window lasts 3 min. */
const RESTART_WAIT_MS = 2 * 60_000

type ContinueTarget = { kind: 'paused' | 'holder'; paneKey: string }

/** Whether "continue" reached the agent, and the account pick a paused pane went through. */
export type ContinueTestTaskResult = { delivered: boolean; pick?: SpotlightResumeAccountPick }

type ContinuePane = {
  tabId: string
  leafId: string
  worktreeId: string
  shellOverride?: string
  ptyId: string
}

/** A paused row is its own pane; a turn is resumed through the pane of it that asked last. */
function continueTarget(board: SpotlightAgentStatus, paneKey: string): ContinueTarget | null {
  if (board.paused?.some((row) => row.paneKey === paneKey)) {
    return { kind: 'paused', paneKey }
  }
  const last = board.turns.find((turn) => turn.paneKeys?.includes(paneKey))?.paneKeys?.at(-1)
  return last ? { kind: 'holder', paneKey: last } : null
}

/** The pane's tab and its live PTY, as the account-switch scan reads them. */
function locatePane(state: AppState, paneKey: string): ContinuePane | null {
  const parsed = parsePaneKey(paneKey)
  if (!parsed) {
    return null
  }
  const ptyId = state.terminalLayoutsByTabId[parsed.tabId]?.ptyIdsByLeafId?.[parsed.leafId]
  if (!ptyId || !(state.ptyIdsByTabId[parsed.tabId] ?? []).includes(ptyId)) {
    return null
  }
  for (const [worktreeId, tabs] of Object.entries(state.tabsByWorktree)) {
    const tab = tabs.find((entry) => entry.id === parsed.tabId)
    if (tab) {
      return {
        tabId: parsed.tabId,
        leafId: parsed.leafId,
        worktreeId,
        ...(tab.shellOverride ? { shellOverride: tab.shellOverride } : {}),
        ptyId
      }
    }
  }
  return null
}

/** Resolves with `read`'s first non-null answer from the store, or null once `timeoutMs` passes. */
function waitForStore<T>(
  read: (state: AppState) => T | null,
  timeoutMs: number
): Promise<T | null> {
  const ready = read(useAppStore.getState())
  if (ready !== null) {
    return Promise.resolve(ready)
  }
  return new Promise((resolve) => {
    let unsubscribe: () => void = () => {}
    const timer = setTimeout(() => {
      unsubscribe()
      resolve(null)
    }, timeoutMs)
    unsubscribe = useAppStore.subscribe((state) => {
      const value = read(state)
      if (value !== null) {
        clearTimeout(timer)
        unsubscribe()
        resolve(value)
      }
    })
  })
}

/** The pane's new PTY once the old one left its tab, mounted or detached restart alike. */
function waitForReplacedPty(pane: ContinuePane): Promise<string | null> {
  return waitForStore((state) => {
    if ((state.ptyIdsByTabId[pane.tabId] ?? []).includes(pane.ptyId)) {
      return null
    }
    const next = state.terminalLayoutsByTabId[pane.tabId]?.ptyIdsByLeafId?.[pane.leafId]
    return next && next !== pane.ptyId ? next : null
  }, RESTART_WAIT_MS)
}

/** Relaunches the pane's conversation on `accountId` and tells it to continue. */
async function restartOnAccount(pane: ContinuePane, accountId: string | null): Promise<boolean> {
  // Why before the switch: with no conversation to resume, Orca's account must not change.
  if (!buildPaneAccountRestartStartup('claude', pane)) {
    return false
  }
  // Why not the status bar's running-session handling: only this pane moves; the others stay put.
  await selectClaudeProviderAccount({ kind: 'local' }, { accountId, runtime: 'host' })
  await useAppStore.getState().fetchSettings()
  useAppStore.getState().queuePaneAccountRestarts([pane.ptyId], 'claude')
  const ptyId = await waitForReplacedPty(pane)
  if (!ptyId) {
    // Why: a restart after main's window closes would tear the paused pane down and lose its place.
    useAppStore.getState().consumePendingPaneAccountRestart(pane.ptyId)
    return false
  }
  return sendFollowupPromptWhenAgentReady({
    ptyId,
    agent: 'claude',
    expectedProcess: TUI_AGENT_CONFIG.claude.expectedProcess,
    prompt: NATIVE_CHAT_USAGE_LIMIT_CONTINUE_MESSAGE
  })
}

/** A paused pane, by the account-switch scan's ladder: continue in place, move it, or leave it. */
async function resumePausedPane(paneKey: string): Promise<ContinueTestTaskResult> {
  const pane = locatePane(useAppStore.getState(), paneKey)
  // Why the PTY check: a remote machine's Claude keeps its own login, which this switch can't move.
  if (!pane || isForeignMachineCodexPtyId(pane.ptyId)) {
    return { delivered: false }
  }
  const pick = await window.api.spotlight.pickResumeAccount()
  if (pick.kind === 'none') {
    // Why the pick: auto-resume retries when the first account gets limit back (`returnsAt`).
    return { delivered: false, pick }
  }
  const host = await window.api.claudeAccounts.list()
  const state = useAppStore.getState()
  const status = state.agentStatusByPaneKey[paneKey]
  const session = normalizeAgentProviderSession(status?.providerSession)
  const folder = resolveClaudePaneFolder(
    session?.transcriptPath,
    state.settings?.claudeManagedAccounts ?? [],
    host
  )
  // Why: the shell keeps a pane's own CLAUDE_CONFIG_DIR, so a restart lands in the same folder.
  if (!folder || folder.kind === 'own-folder') {
    return { delivered: false, pick }
  }
  if (isClaudePaneOnAccount(folder, claudeLaunchAccountId(host, pick.accountId), host)) {
    // Its account has limit again and Claude sits at its prompt: no restart needed.
    const delivered = await sendBracketedPasteToRunningAgent({
      ptyId: pane.ptyId,
      content: NATIVE_CHAT_USAGE_LIMIT_CONTINUE_MESSAGE
    })
    return { delivered, pick }
  }
  return { delivered: await restartOnAccount(pane, pick.accountId), pick }
}

/** An idle holder keeps its turn and its account: stop what it runs, then tell it to continue. */
async function nudgeIdleHolder(paneKey: string): Promise<boolean> {
  const pane = locatePane(useAppStore.getState(), paneKey)
  if (!pane) {
    return false
  }
  // Why 'driving': only driving input turns Esc into the agent's cancellation.
  window.api.pty.write(pane.ptyId, '\x1b', 'driving')
  // Why the gap: an Esc glued to the paste's own escape sequence reads as one key to the agent.
  await new Promise((resolve) => setTimeout(resolve, ESC_PASTE_GAP_MS))
  await waitForStore(
    (state) => (state.agentStatusByPaneKey[paneKey]?.state === 'working' ? null : true),
    ESC_SETTLE_MS
  )
  return sendBracketedPasteToRunningAgent({
    ptyId: pane.ptyId,
    content: NATIVE_CHAT_USAGE_LIMIT_CONTINUE_MESSAGE
  })
}

/**
 * Continuar on a paused pane or on a turn's holder. Main opens its resume window first and closes
 * it at the end; `delivered: false` leaves a paused pane `Pausado` in its place. Never grants a
 * turn.
 */
export async function continueTestTask(
  paneKey: string,
  options: { auto: boolean }
): Promise<ContinueTestTaskResult> {
  const found = continueTarget(useAppStore.getState().spotlightTurns, paneKey)
  // Why: auto-resume only resumes paused panes; interrupting a holder always takes Juan's click.
  const target = options.auto && found?.kind !== 'paused' ? null : found
  const opened =
    target !== null &&
    (await window.api.spotlight.markResuming(target.paneKey, options).catch(() => false))
  if (!target || !opened) {
    return { delivered: false }
  }
  let result: ContinueTestTaskResult = { delivered: false }
  try {
    result =
      target.kind === 'paused'
        ? await resumePausedPane(target.paneKey)
        : { delivered: await nudgeIdleHolder(target.paneKey) }
  } catch (error) {
    console.warn('[test-queue] Continuar failed:', error)
  }
  await window.api.spotlight
    .resumeSettled(target.paneKey, { delivered: result.delivered })
    .catch((error: unknown) => console.warn('[test-queue] Continuar could not settle:', error))
  return result
}
