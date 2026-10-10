// Every Spotlight server start decision leaves one line in the repo's .orca/spotlight.log, in the
// "Server started by Orca" marker format. Why: a start that typed nothing used to leave no trace.
import {
  describeSpotlightAutostartNote,
  spotlightServerStartedNote,
  type SpotlightAutostartNote
} from '../../shared/spotlight-autostart-note'
import { appendSpotlightLogNote } from './spotlight-log-mirror'
import { getPreparedSpotlightLaunchLine } from './spotlight-server-commands'

/** Why a start typed nothing into a registered Spotlight terminal. */
export type SpotlightStartSkip =
  /** Something runs there that Orca didn't start, or runs another command it may not replace. */
  | 'busy'
  /** Orca's own server for this command already runs; hot reload covers code changes. */
  | 'orca-server'
  /** Orca typed a line moments ago, which the shell may not have forked yet. */
  | 'just-typed'
  /** A line queued for this terminal may still be on its way into the shell. */
  | 'queued-line'
  /** A restart is between its interrupt and re-run, and re-runs the latest command itself. */
  | 'restart'
  /** The terminal's foreground could not be read, so nothing is typed into it. */
  | 'unreadable'
  /** The PTY host answered that the terminal's PTY no longer exists. */
  | 'terminal-gone'

const SKIP_NOTES: Record<SpotlightStartSkip, string> = {
  busy: 'Server left alone — the Spotlight terminal is busy',
  'orca-server': "Server left alone — Orca's server for this command already runs there",
  'just-typed': 'Server left alone — Orca typed a server line there moments ago',
  'queued-line': 'Server left alone — the server line queued for its terminal is still starting',
  restart: 'Server left alone — a restart is already re-running it',
  unreadable: "Server not started — the Spotlight terminal's state could not be read",
  'terminal-gone': "Server not started — the Spotlight terminal's PTY no longer exists"
}

export function noteSpotlightServerStarted(rootPath: string, line: string): void {
  void appendSpotlightLogNote(rootPath, spotlightServerStartedNote(line))
}

export function noteSpotlightStartSkipped(rootPath: string, skip: SpotlightStartSkip): void {
  void appendSpotlightLogNote(rootPath, SKIP_NOTES[skip])
}

/** A decision the renderer took (no command, queued, dropped…), quoting the line main prepared. */
export function noteSpotlightAutostart(
  repoId: string,
  rootPath: string,
  note: SpotlightAutostartNote
): void {
  const line = getPreparedSpotlightLaunchLine(repoId)
  void appendSpotlightLogNote(rootPath, describeSpotlightAutostartNote(note, line))
}
