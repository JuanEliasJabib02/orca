import type {
  SpotlightChangedEvent,
  SpotlightOpResult,
  SpotlightServerStartResult,
  SpotlightServerState,
  SpotlightStateSnapshot
} from '../../shared/spotlight'
import type { SpotlightAutostartNote } from '../../shared/spotlight-autostart-note'
import type { SpotlightVariantInference } from '../../shared/spotlight-server-variant'

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
   *  main keeps the command for later restarts. `restartIfDifferent` also replaces a running
   *  server Orca started for another command (never one started by hand). */
  startServer: (args: {
    repoId: string
    command: string
    restartIfDifferent?: boolean
  }) => Promise<SpotlightServerStartResult>
  /** For a Spotlight terminal with no PTY yet: the line to queue as its startup command (with a
   *  pending install first); main keeps the command for restarts. Null when Spotlight is off for
   *  the repo or the command is invalid. */
  prepareServerLaunch: (args: { repoId: string; command: string }) => Promise<string | null>
  /** The prepared line will never run (its queue entry was dropped, or the PTY bound first): main
   *  stops counting it as Orca's server and puts back the install it took. Call before any
   *  fallback start, so that start installs first. */
  cancelPreparedServerLaunch: (args: { repoId: string }) => Promise<void>
  /** Whether the server runs in `ptyId`, read like start and turn-off read it. `unknown` unless
   *  Spotlight is on for the repo and `ptyId` is its registered Spotlight terminal. */
  serverState: (args: { repoId: string; ptyId: string }) => Promise<SpotlightServerState>
  /** One line in the repo's Spotlight log about an autostart decision; main words it. */
  noteServerAutostart: (args: { repoId: string; note: SpotlightAutostartNote }) => Promise<void>
  /** The variant (`apps/<V>/`) the holder worktree's branch changed: one is inferred, several or none
   *  are ambiguous. Ambiguous with no candidates unless `worktreeId` holds the repo's local Spotlight. */
  inferServerVariant: (args: {
    repoId: string
    worktreeId: string
  }) => Promise<SpotlightVariantInference>
  onChanged: (callback: (event: SpotlightChangedEvent) => void) => () => void
}
