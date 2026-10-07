// Spotlight turned off before main mirrored the Spotlight tab's PTY, and its pane still handed the
// queued server line to the shell: interrupt what that line runs, by the shared stray-startup rule.
import { useAppStore } from '@/store'
import { watchStraySpotlightStartup } from '../../../shared/spotlight-stray-startup'

/** Call only once the tab's pane spent the queued line on `ptyId` (it ran it); stops when Spotlight
 *  comes back on (its activation owns the terminal), the tab or its PTY goes, or the rule is done. */
export function interruptStraySpotlightStartup(args: {
  repoId: string
  worktreeId: string
  tabId: string
  ptyId: string
}): void {
  const { repoId, worktreeId, tabId, ptyId } = args
  watchStraySpotlightStartup({
    isRunning: () => window.api.pty.hasChildProcesses(ptyId),
    interrupt: () => {
      window.api.pty.write(ptyId, '\x03', 'driving')
      return true
    },
    shouldStop: () => {
      const state = useAppStore.getState()
      const tab = state.tabsByWorktree[worktreeId]?.find((entry) => entry.id === tabId)
      return tab?.ptyId !== ptyId || Boolean(state.spotlightByRepo[repoId])
    }
  })
}
