// Spotlight turned off while a pane was already spawning the Spotlight tab with the queued server
// command: dropping the queue entry can't recall that spawn, so interrupt what it runs instead.
import { useAppStore } from '@/store'
import type { AppState } from '@/store/types'

export const SPOTLIGHT_STRAY_STARTUP_WATCH_MS = 30_000
export const SPOTLIGHT_STRAY_STARTUP_POLL_MS = 500
// Why two: the command runs only after the shell's startup files, whose own short-lived
// processes one reading could catch, spending the single interrupt before the server starts.
const RUNNING_READINGS_TO_INTERRUPT = 2

type StrayStartupState = Pick<AppState, 'tabsByWorktree' | 'spotlightByRepo'>

/** Once the tab's PTY binds, Ctrl-C it a single time when it runs a process, unless Spotlight comes
 *  back on (its own activation then owns the terminal), the tab closes, or the watch window ends. */
export function interruptStraySpotlightStartup(args: {
  repoId: string
  worktreeId: string
  tabId: string
}): void {
  const { repoId, worktreeId, tabId } = args
  let done = false
  let polling = false
  let runningReadings = 0
  let pollTimer: ReturnType<typeof setTimeout> | null = null
  let deadline: ReturnType<typeof setTimeout> | null = null
  let unsubscribe: () => void = () => {}
  const finish = (): void => {
    done = true
    unsubscribe()
    if (deadline !== null) {
      clearTimeout(deadline)
    }
    if (pollTimer !== null) {
      clearTimeout(pollTimer)
    }
  }
  const read = async (ptyId: string): Promise<void> => {
    let running = false
    try {
      running = await window.api.pty.hasChildProcesses(ptyId)
    } catch {
      running = false
    }
    if (done) {
      return
    }
    if (useAppStore.getState().spotlightByRepo[repoId]) {
      finish()
      return
    }
    runningReadings = running ? runningReadings + 1 : 0
    if (runningReadings >= RUNNING_READINGS_TO_INTERRUPT) {
      window.api.pty.write(ptyId, '\x03', 'driving')
      finish()
      return
    }
    pollTimer = setTimeout(() => void read(ptyId), SPOTLIGHT_STRAY_STARTUP_POLL_MS)
  }
  const check = (state: StrayStartupState): void => {
    if (done || polling) {
      return
    }
    const tab = state.tabsByWorktree[worktreeId]?.find((entry) => entry.id === tabId)
    if (!tab || state.spotlightByRepo[repoId]) {
      finish()
      return
    }
    const ptyId = tab.ptyId
    if (ptyId) {
      polling = true
      unsubscribe()
      pollTimer = setTimeout(() => void read(ptyId), SPOTLIGHT_STRAY_STARTUP_POLL_MS)
    }
  }
  deadline = setTimeout(finish, SPOTLIGHT_STRAY_STARTUP_WATCH_MS)
  unsubscribe = useAppStore.subscribe(check)
  check(useAppStore.getState())
}
