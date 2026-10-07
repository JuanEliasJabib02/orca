import { useCallback, useMemo, useSyncExternalStore } from 'react'
import { useAppStore } from '@/store'
import type { AppState } from '@/store/types'

export const SPOTLIGHT_SERVER_POLL_INTERVAL_MS = 3000

export type SpotlightServerStatus = {
  /** null = unknown: not checkable yet, or the check failed. */
  running: boolean | null
  port?: number
}

type PollEntry = {
  running: boolean | null
  listeners: Set<() => void>
  timer: ReturnType<typeof setInterval>
  inFlight: boolean
}

// Keyed by PTY: a repo has one Spotlight terminal, so one PTY is one poll no
// matter how many rows show its status.
const entries = new Map<string, PollEntry>()

const NOOP = (): void => {}

/** PTY of the repo's Spotlight terminal, or null while Spotlight is off or the
 *  terminal has no live PTY. Primitive result so selectors re-render only on change. */
export function findSpotlightTerminalPtyId(
  state: Pick<AppState, 'spotlightByRepo' | 'worktreesByRepo' | 'tabsByWorktree'>,
  repoId: string
): string | null {
  if (!state.spotlightByRepo?.[repoId]) {
    return null
  }
  const mainWorktree = state.worktreesByRepo?.[repoId]?.find((entry) => entry.isMainWorktree)
  if (!mainWorktree) {
    return null
  }
  const tab = state.tabsByWorktree?.[mainWorktree.id]?.find((entry) => entry.spotlightRepoRoot)
  return tab?.ptyId ?? null
}

async function pollOnce(ptyId: string, entry: PollEntry): Promise<void> {
  if (entry.inFlight) {
    return
  }
  entry.inFlight = true
  let next: boolean | null
  try {
    next = await window.api.pty.hasChildProcesses(ptyId)
  } catch {
    next = null
  }
  entry.inFlight = false
  // The last subscriber may have left while the check was in flight.
  if (entries.get(ptyId) !== entry || entry.running === next) {
    return
  }
  entry.running = next
  for (const listener of entry.listeners) {
    listener()
  }
}

function subscribeToServerStatus(ptyId: string, listener: () => void): () => void {
  let entry = entries.get(ptyId)
  if (!entry) {
    const created: PollEntry = {
      running: null,
      listeners: new Set(),
      timer: setInterval(() => void pollOnce(ptyId, created), SPOTLIGHT_SERVER_POLL_INTERVAL_MS),
      inFlight: false
    }
    entries.set(ptyId, created)
    entry = created
    void pollOnce(ptyId, created)
  }
  entry.listeners.add(listener)
  const subscribed = entry
  return () => {
    subscribed.listeners.delete(listener)
    if (subscribed.listeners.size > 0) {
      return
    }
    clearInterval(subscribed.timer)
    if (entries.get(ptyId) === subscribed) {
      entries.delete(ptyId)
    }
  }
}

function readServerRunning(ptyId: string | null): boolean | null {
  return ptyId ? (entries.get(ptyId)?.running ?? null) : null
}

/** Whether the repo's dev server runs in its Spotlight terminal, polled from the
 *  PTY's child processes. Pass `enabled: false` from rows that don't show it so
 *  they neither poll nor re-render on its changes. */
export function useSpotlightServerStatus(repoId: string, enabled = true): SpotlightServerStatus {
  const ptyId = useAppStore((s) => (enabled ? findSpotlightTerminalPtyId(s, repoId) : null))
  const port = useAppStore((s) =>
    enabled ? s.repos?.find((repo) => repo.id === repoId)?.spotlightServer?.port : undefined
  )
  const subscribe = useCallback(
    (listener: () => void) => (ptyId ? subscribeToServerStatus(ptyId, listener) : NOOP),
    [ptyId]
  )
  const running = useSyncExternalStore(
    subscribe,
    () => readServerRunning(ptyId),
    () => null
  )
  return useMemo(() => ({ running, port }), [running, port])
}
