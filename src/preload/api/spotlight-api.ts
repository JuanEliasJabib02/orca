import type {
  SpotlightChangedEvent,
  SpotlightOpResult,
  SpotlightServerRestartResult,
  SpotlightServerStartResult,
  SpotlightStateSnapshot
} from '../../shared/spotlight'

export type SpotlightApi = {
  /** Main is the source of truth; the renderer hydrates this snapshot at startup. */
  getState: () => Promise<SpotlightStateSnapshot>
  /** Activate for a worktree. Re-activating the current holder re-syncs;
   *  activating from another worktree of the same repo is a takeover. */
  activate: (args: {
    repoId: string
    worktreeId: string
    force?: boolean
  }) => Promise<SpotlightOpResult>
  /** Re-sync the current holder's changes onto the root. */
  sync: (args: { repoId: string; force?: boolean }) => Promise<SpotlightOpResult>
  /** Release the Spotlight and restore the root's original state. */
  deactivate: (args: { repoId: string; force?: boolean }) => Promise<SpotlightOpResult>
  /** Mirror this PTY's output to <root>/.orca/spotlight.log (the workspace's
   *  Spotlight terminal) so agents in any worktree can read server logs. */
  setLogPty: (args: { repoId: string; ptyId: string }) => Promise<void>
  clearLogPty: (args: { repoId: string; ptyId?: string }) => Promise<void>
  /** Type the server command into the active Spotlight terminal, only when it is idle;
   *  main keeps the command for later restarts. */
  startServer: (args: { repoId: string; command: string }) => Promise<SpotlightServerStartResult>
  /** Ctrl-C, then re-run `command` (or the last one Orca ran; history recall when none). */
  restartServer: (args: {
    repoId: string
    command?: string
  }) => Promise<SpotlightServerRestartResult>
  onChanged: (callback: (event: SpotlightChangedEvent) => void) => () => void
}
