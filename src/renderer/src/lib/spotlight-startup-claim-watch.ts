import { useAppStore } from '@/store'
import type { AppState } from '@/store/types'
import type { SpotlightQueuedLineDrop } from '../../../shared/spotlight-autostart-note'
import { interruptStraySpotlightStartup } from '@/lib/spotlight-stray-startup-interrupt'

// A background mount spawns within frames; past this the queued command is dropped, never run late.
export const SPOTLIGHT_STARTUP_CLAIM_TIMEOUT_MS = 30_000

type ClaimWatchState = Pick<
  AppState,
  'pendingStartupByTabId' | 'tabsByWorktree' | 'spotlightByRepo'
>

/** The tab's PTY, null while it has none, undefined once the tab is gone. */
function findTabPtyId(
  state: ClaimWatchState,
  worktreeId: string,
  tabId: string
): string | null | undefined {
  const tab = state.tabsByWorktree[worktreeId]?.find((entry) => entry.id === tabId)
  return tab ? tab.ptyId : undefined
}

/**
 * Follows the Spotlight server command queued on a tab until a pane spends it. A pane reads its
 * startup command only when it mounts, and spends it synchronously right after binding its PTY.
 * So when the tab's PTY binds and the command is still queued a tick later, a pane mounted before
 * the queue spawned that PTY and will never run it: drop the entry (a later remount must not run
 * it either) and call `onUnclaimed` to start the server in the live shell instead, or `onDropped`
 * when Spotlight is off by then. The tab closing or the timeout drop the entry too. A pane that
 * spends it while Spotlight is on calls `onClaimed`: the new PTY was spawned with the line.
 * Spotlight turning off before the bind keeps the entry: only a pane spending it proves the line
 * reached a shell, which is then interrupted (main never mirrors a PTY bound with Spotlight off).
 * Spotlight coming back on before the bind drops it: a newer activation queues its own command.
 */
export function watchSpotlightStartupClaim(args: {
  repoId: string
  worktreeId: string
  tabId: string
  onDropped: (reason: SpotlightQueuedLineDrop) => void
  onUnclaimed: () => void
  onClaimed?: () => void
}): void {
  const { repoId, worktreeId, tabId, onDropped, onUnclaimed, onClaimed } = args
  const queued = useAppStore.getState().pendingStartupByTabId[tabId]
  if (!queued) {
    return
  }
  let done = false
  let spotlightWentOff = false
  let unsubscribe: () => void = () => {}
  let timer: ReturnType<typeof setTimeout> | null = null
  const stop = (drop: SpotlightQueuedLineDrop | null): void => {
    if (done) {
      return
    }
    done = true
    unsubscribe()
    if (timer !== null) {
      clearTimeout(timer)
    }
    if (drop !== null) {
      useAppStore.getState().consumeTabStartupCommand(tabId, queued)
      onDropped(drop)
    }
  }
  timer = setTimeout(() => stop('timeout'), SPOTLIGHT_STARTUP_CLAIM_TIMEOUT_MS)

  /** The entry left the queue after `ptyId` bound. Spent by the pane (not replaced) while
   *  Spotlight was off, the line runs in a shell main never mirrored: the renderer interrupts it. */
  const settleSpent = (state: ClaimWatchState, ptyId: string, spotlightOnAtBind: boolean): void => {
    if (state.pendingStartupByTabId[tabId] !== undefined) {
      return
    }
    if (spotlightOnAtBind) {
      onClaimed?.()
    } else {
      interruptStraySpotlightStartup({ repoId, worktreeId, tabId, ptyId })
    }
  }
  const check = (state: ClaimWatchState): void => {
    if (done) {
      return
    }
    const ptyId = findTabPtyId(state, worktreeId, tabId)
    if (state.pendingStartupByTabId[tabId] !== queued) {
      // Spent by the pane that bound the PTY, replaced by a newer command, or closed with its tab.
      stop(null)
      if (ptyId === undefined) {
        onDropped('tab-closed')
      } else if (ptyId !== null) {
        settleSpent(state, ptyId, Boolean(state.spotlightByRepo[repoId]))
      }
      return
    }
    if (ptyId === undefined) {
      stop('tab-closed')
      return
    }
    if (ptyId === null) {
      const spotlightOn = Boolean(state.spotlightByRepo[repoId])
      spotlightWentOff ||= !spotlightOn
      if (spotlightOn && spotlightWentOff) {
        // Main forgot this line at turn-off, so there's nothing to cancel there.
        stop(null)
        useAppStore.getState().consumeTabStartupCommand(tabId, queued)
      }
      return
    }
    const spotlightOnAtBind = Boolean(state.spotlightByRepo[repoId])
    stop(null)
    // Why a tick: the owning pane spends the entry in the same synchronous call that binds the PTY.
    setTimeout(() => {
      const store = useAppStore.getState()
      if (store.pendingStartupByTabId[tabId] !== queued) {
        settleSpent(store, ptyId, spotlightOnAtBind)
        return
      }
      store.consumeTabStartupCommand(tabId, queued)
      if (store.spotlightByRepo[repoId]) {
        onUnclaimed()
      } else {
        onDropped('spotlight-off')
      }
    }, 0)
  }
  unsubscribe = useAppStore.subscribe(check)
  check(useAppStore.getState())
}
