import { useAppStore } from '@/store'
import type { AppState } from '@/store/types'
import { appendTerminalToPersistedTabOrder } from '@/components/tab-bar/reconcile-order'
import { activateAndRevealWorktree } from '@/lib/worktree-activation'
import { translate } from '@/i18n/i18n'

export type OpenSpotlightTerminalTabResult =
  | {
      ok: true
      /** The main worktree that hosts the Spotlight terminal. */
      worktreeId: string
      tabId: string
      /** The tab's live PTY; null when it spawns on its next mount. */
      ptyId: string | null
      /** `startupCommand` was queued, so the pane runs it when it spawns. */
      startupQueued: boolean
      /** Settles once main mirrors the live PTY, i.e. can type into it. */
      logPtyRegistered: Promise<void>
    }
  | { ok: false; reason: 'no-main-worktree' }

export type OpenSpotlightTerminalTabArgs = {
  repoId: string
  /** When true, switch to the main worktree's workspace and focus the tab —
   *  the "jump to server" gesture. When false, just make sure the tab exists
   *  without pulling the user away from their current workspace. */
  reveal: boolean
  /** Queued as the tab's startup command when it has no PTY yet, before its pane can mount. */
  startupCommand?: string
}

/** Which terminal `openSpotlightTerminalTab` would use; `ptyId: null` means it must still spawn. */
export type SpotlightTerminalPlan =
  | { kind: 'no-main-worktree' }
  | {
      kind: 'existing' | 'adopt'
      worktreeId: string
      rootPath: string
      tabId: string
      ptyId: string | null
    }
  | { kind: 'create'; worktreeId: string; rootPath: string; ptyId: null }

type SpotlightTerminalPlanState = Pick<
  AppState,
  'worktreesByRepo' | 'tabsByWorktree' | 'activeTabIdByWorktree'
>

/** A terminal that already runs the server (or a plain shell) at the root is
 *  safe to adopt as the Spotlight terminal. An agent/chat tab is NOT — adopting
 *  it would rename it, mirror its transcript as "server logs", and expose it to
 *  the Ctrl-C restart trigger. */
function isAdoptableTerminal(tab: { viewMode?: string; launchAgent?: unknown }): boolean {
  return tab.viewMode !== 'chat' && tab.launchAgent === undefined
}

export function planSpotlightTerminal(
  state: SpotlightTerminalPlanState,
  repoId: string
): SpotlightTerminalPlan {
  const mainWorktree = state.worktreesByRepo[repoId]?.find((entry) => entry.isMainWorktree)
  if (!mainWorktree) {
    return { kind: 'no-main-worktree' }
  }
  const worktreeId = mainWorktree.id
  const rootPath = mainWorktree.path
  const mainTabs = state.tabsByWorktree[worktreeId] ?? []
  const existing = mainTabs.find((tab) => tab.spotlightRepoRoot)
  if (existing) {
    return { kind: 'existing', worktreeId, rootPath, tabId: existing.id, ptyId: existing.ptyId }
  }
  // The user often already has a plain terminal running the server at the root
  // — adopt it instead of opening an empty duplicate. Never adopt an agent/chat
  // tab. Every terminal in the main workspace has the root as its spawn cwd.
  const activeMainTabId = state.activeTabIdByWorktree[worktreeId]
  const preferred = mainTabs.find((tab) => tab.id === activeMainTabId)
  const adopted =
    preferred && isAdoptableTerminal(preferred)
      ? preferred
      : mainTabs.find((tab) => isAdoptableTerminal(tab))
  if (adopted) {
    return { kind: 'adopt', worktreeId, rootPath, tabId: adopted.id, ptyId: adopted.ptyId }
  }
  return { kind: 'create', worktreeId, rootPath, ptyId: null }
}

function registerLogPty(repoId: string, ptyId: string | null): Promise<void> {
  if (!ptyId) {
    return Promise.resolve()
  }
  // Optional-chained: a renderer/preload version skew must never break opening the terminal.
  return Promise.resolve(window.api.spotlight?.setLogPty?.({ repoId, ptyId })).catch((error) =>
    console.warn('[spotlight] Failed to mirror the Spotlight terminal log:', error)
  )
}

function revealSpotlightTab(worktreeId: string, tabId: string): void {
  activateAndRevealWorktree(worktreeId)
  const store = useAppStore.getState()
  store.setActiveTabForWorktree(worktreeId, tabId)
  // Only flip the pane when revealing — otherwise a reveal:false activation
  // from a feature workspace would yank the root's pane to the terminal.
  store.setActiveTabType('terminal', worktreeId)
}

/** Creates the Spotlight tab, or marks an adopted one; returns its id. */
function ensureSpotlightTab(
  plan: Exclude<SpotlightTerminalPlan, { kind: 'no-main-worktree' }>
): string {
  const store = useAppStore.getState()
  const title = translate('auto.lib.open.spotlight.terminal.tab.title', 'Spotlight')
  if (plan.kind === 'existing') {
    return plan.tabId
  }
  if (plan.kind === 'adopt') {
    store.markTabSpotlightRepoRoot(plan.tabId)
    store.setTabCustomTitle(plan.tabId, title, { recordInteraction: false })
    return plan.tabId
  }
  const tab = store.createTab(plan.worktreeId, undefined, undefined, { spotlightRepoRoot: true })
  // customTitle wins over OSC title updates, so the label sticks.
  store.setTabCustomTitle(tab.id, title, { recordInteraction: false })
  appendTerminalToPersistedTabOrder(useAppStore.getState(), plan.worktreeId, tab.id)
  return tab.id
}

/**
 * Open (or reveal) the repo's single "Spotlight" terminal: a terminal tab in
 * the MAIN worktree's workspace whose cwd is the repository root — the fixed
 * home of the user's dev server. One per repo: activation/takeover from any
 * workspace reuses it, so the server and its log capture never move.
 * Synchronous on purpose: a queued startup command lands before any pane can mount.
 */
export function openSpotlightTerminalTab({
  repoId,
  reveal,
  startupCommand
}: OpenSpotlightTerminalTabArgs): OpenSpotlightTerminalTabResult {
  const store = useAppStore.getState()
  const plan = planSpotlightTerminal(store, repoId)
  if (plan.kind === 'no-main-worktree') {
    return { ok: false, reason: 'no-main-worktree' }
  }
  const tabId = ensureSpotlightTab(plan)
  // A tab whose PTY died (or never spawned after a session restore) must respawn in the root.
  if (plan.kind !== 'adopt' && plan.ptyId === null) {
    store.queueTabInitialCwd(tabId, plan.rootPath)
  }
  const queuedCommand = plan.ptyId === null && startupCommand ? startupCommand : null
  if (queuedCommand) {
    store.queueTabStartupCommand(tabId, { command: queuedCommand })
  }
  // A live PTY won't fire the updateTabPtyId capture hook (its ptyId is unchanged), so
  // re-register the log mirror directly: after an off→on cycle nothing else would.
  const logPtyRegistered = registerLogPty(repoId, plan.ptyId)
  if (reveal) {
    revealSpotlightTab(plan.worktreeId, tabId)
  }
  return {
    ok: true,
    worktreeId: plan.worktreeId,
    tabId,
    ptyId: plan.ptyId,
    startupQueued: queuedCommand !== null,
    logPtyRegistered
  }
}
