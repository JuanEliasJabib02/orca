import { useCallback, useMemo, useSyncExternalStore } from 'react'
import { useAppStore } from '@/store'
import type { AppState } from '@/store/types'
import type { SpotlightServerState } from '../../../../shared/spotlight'

export const SPOTLIGHT_SERVER_POLL_INTERVAL_MS = 3000

export type SpotlightServerStatus = {
  /** null = unknown: not checkable yet, or the check failed. */
  running: boolean | null
  port?: number
}

type PollEntry = {
  repoId: string
  running: boolean | null
  listeners: Set<() => void>
  inFlight: boolean
}

// Keyed by PTY: a repo has one Spotlight terminal, so one PTY is one poll no
// matter how many rows show its status.
const entries = new Map<string, PollEntry>()
// One timer for every repo, so their checks land together and share the host's process-table read.
let pollTimer: ReturnType<typeof setInterval> | null = null

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

function toRunning(state: SpotlightServerState): boolean | null {
  return state === 'running' ? true : state === 'stopped' ? false : null
}

async function pollOnce(ptyId: string, entry: PollEntry): Promise<void> {
  if (entry.inFlight) {
    return
  }
  entry.inFlight = true
  let next: boolean | null
  try {
    // Main reads process groups: a `sh` script (a `pnpm` shim) running there counts as running.
    next = toRunning(await window.api.spotlight.serverState({ repoId: entry.repoId, ptyId }))
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

function pollAll(): void {
  for (const [ptyId, entry] of entries) {
    void pollOnce(ptyId, entry)
  }
}

function subscribeToServerStatus(repoId: string, ptyId: string, listener: () => void): () => void {
  let entry = entries.get(ptyId)
  if (!entry) {
    const created: PollEntry = { repoId, running: null, listeners: new Set(), inFlight: false }
    entries.set(ptyId, created)
    entry = created
    pollTimer ??= setInterval(pollAll, SPOTLIGHT_SERVER_POLL_INTERVAL_MS)
    void pollOnce(ptyId, created)
  }
  entry.listeners.add(listener)
  const subscribed = entry
  return () => {
    subscribed.listeners.delete(listener)
    if (subscribed.listeners.size > 0) {
      return
    }
    if (entries.get(ptyId) === subscribed) {
      entries.delete(ptyId)
    }
    if (entries.size === 0 && pollTimer) {
      clearInterval(pollTimer)
      pollTimer = null
    }
  }
}

function readServerRunning(ptyId: string | null): boolean | null {
  return ptyId ? (entries.get(ptyId)?.running ?? null) : null
}

/** Whether the repo's dev server runs in its Spotlight terminal, polled from main's
 *  reading of that terminal. Pass `enabled: false` from rows that don't show it so
 *  they neither poll nor re-render on its changes. */
export function useSpotlightServerStatus(repoId: string, enabled = true): SpotlightServerStatus {
  const ptyId = useAppStore((s) => (enabled ? findSpotlightTerminalPtyId(s, repoId) : null))
  const port = useAppStore((s) =>
    enabled ? s.repos?.find((repo) => repo.id === repoId)?.spotlightServer?.port : undefined
  )
  const subscribe = useCallback(
    (listener: () => void) => (ptyId ? subscribeToServerStatus(repoId, ptyId, listener) : NOOP),
    [repoId, ptyId]
  )
  const running = useSyncExternalStore(
    subscribe,
    () => readServerRunning(ptyId),
    () => null
  )
  return useMemo(() => ({ running, port }), [running, port])
}
