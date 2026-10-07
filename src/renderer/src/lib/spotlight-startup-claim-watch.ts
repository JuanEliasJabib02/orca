import { useAppStore } from '@/store'
import type { AppState } from '@/store/types'

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
 * it either) and call `onUnclaimed` to start the server in the live shell instead. Spotlight
 * turning off, the tab closing, or the timeout drop the entry too.
 */
export function watchSpotlightStartupClaim(args: {
  repoId: string
  worktreeId: string
  tabId: string
  onUnclaimed: () => void
}): void {
  const { repoId, worktreeId, tabId, onUnclaimed } = args
  const queued = useAppStore.getState().pendingStartupByTabId[tabId]
  if (!queued) {
    return
  }
  let done = false
  let unsubscribe: () => void = () => {}
  let timer: ReturnType<typeof setTimeout> | null = null
  const stop = (dropQueued: boolean): void => {
    if (done) {
      return
    }
    done = true
    unsubscribe()
    if (timer !== null) {
      clearTimeout(timer)
    }
    if (dropQueued) {
      useAppStore.getState().consumeTabStartupCommand(tabId, queued)
    }
  }
  timer = setTimeout(() => stop(true), SPOTLIGHT_STARTUP_CLAIM_TIMEOUT_MS)

  const check = (state: ClaimWatchState): void => {
    if (done) {
      return
    }
    if (state.pendingStartupByTabId[tabId] !== queued) {
      stop(false)
      return
    }
    const ptyId = findTabPtyId(state, worktreeId, tabId)
    if (ptyId === undefined || !state.spotlightByRepo[repoId]) {
      stop(true)
      return
    }
    if (ptyId === null) {
      return
    }
    stop(false)
    // Why a tick: the owning pane spends the entry in the same synchronous call that binds the PTY.
    setTimeout(() => {
      const store = useAppStore.getState()
      if (store.pendingStartupByTabId[tabId] !== queued) {
        return
      }
      store.consumeTabStartupCommand(tabId, queued)
      onUnclaimed()
    }, 0)
  }
  unsubscribe = useAppStore.subscribe(check)
  check(useAppStore.getState())
}
