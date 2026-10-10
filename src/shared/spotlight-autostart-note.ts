// One line in the repo's .orca/spotlight.log per Spotlight server autostart decision the renderer
// takes. Why: a start that typed nothing used to read only as a missing "Server started" line.
import { isSpotlightServerEnv, type SpotlightServerEnv } from './spotlight-server-types'

/** Why a server line queued for a new Spotlight terminal never ran there. */
export type SpotlightQueuedLineDrop = 'timeout' | 'tab-closed' | 'spotlight-off'

/** Why the start request for a live Spotlight terminal failed (after its retries). */
export type SpotlightStartRequestFailure =
  | 'no-terminal'
  | 'not-active'
  | 'invalid-command'
  | 'error'

/** An autostart outcome the renderer reports; main words it and adds the queued line it prepared. */
export type SpotlightAutostartNote =
  | { kind: 'no-command'; env: SpotlightServerEnv }
  /** The command needs a variant: a prompt asks for it, or none is known to fill in. */
  | { kind: 'needs-variant'; asked: boolean }
  | { kind: 'plan-failed' }
  | { kind: 'no-main-worktree' }
  /** Main refused to prepare the queued line (Spotlight no longer active), or the request failed. */
  | { kind: 'prepare-failed'; refused: boolean }
  | { kind: 'queued' }
  /** The new terminal's pane spawned it with the queued line as its startup command. */
  | { kind: 'queued-started' }
  | { kind: 'queued-dropped'; reason: SpotlightQueuedLineDrop }
  | { kind: 'start-failed'; reason: SpotlightStartRequestFailure }

const QUEUED_LINE_DROPS: readonly SpotlightQueuedLineDrop[] = [
  'timeout',
  'tab-closed',
  'spotlight-off'
]
const START_REQUEST_FAILURES: readonly SpotlightStartRequestFailure[] = [
  'no-terminal',
  'not-active',
  'invalid-command',
  'error'
]

function isOneOf<T extends string>(options: readonly T[], value: unknown): value is T {
  return options.some((option) => option === value)
}

/** The note an IPC payload holds; null for anything else (the renderer never picks the text). */
export function parseSpotlightAutostartNote(value: unknown): SpotlightAutostartNote | null {
  if (value === null || typeof value !== 'object' || !('kind' in value)) {
    return null
  }
  switch (value.kind) {
    case 'no-command':
      return 'env' in value && isSpotlightServerEnv(value.env)
        ? { kind: 'no-command', env: value.env }
        : null
    case 'needs-variant':
      return { kind: 'needs-variant', asked: 'asked' in value && value.asked === true }
    case 'prepare-failed':
      return { kind: 'prepare-failed', refused: 'refused' in value && value.refused === true }
    case 'queued-dropped':
      return 'reason' in value && isOneOf(QUEUED_LINE_DROPS, value.reason)
        ? { kind: 'queued-dropped', reason: value.reason }
        : null
    case 'start-failed':
      return 'reason' in value && isOneOf(START_REQUEST_FAILURES, value.reason)
        ? { kind: 'start-failed', reason: value.reason }
        : null
    case 'plan-failed':
    case 'no-main-worktree':
    case 'queued':
    case 'queued-started':
      return { kind: value.kind }
    default:
      return null
  }
}

/** The marker Orca writes when it types (or hands a new terminal) a server line. */
export function spotlightServerStartedNote(line: string): string {
  return `Server started by Orca ("${line}")`
}

const ENV_LABELS: Record<SpotlightServerEnv, string> = { local: 'Local', dev: 'Dev', prod: 'Prod' }

const DROP_REASONS: Record<SpotlightQueuedLineDrop, string> = {
  timeout: 'its terminal did not spawn in time',
  'tab-closed': 'its terminal tab closed first',
  'spotlight-off': 'Spotlight turned off first'
}

const START_FAILURES: Record<SpotlightStartRequestFailure, string> = {
  'no-terminal': 'no Spotlight terminal was registered',
  'not-active': 'Spotlight is no longer active',
  'invalid-command': 'the command is empty or not one line',
  error: 'the start request failed'
}

/** One short line for the log. `line` is the queued line main prepared, when it still has it. */
export function describeSpotlightAutostartNote(
  note: SpotlightAutostartNote,
  line: string | undefined
): string {
  switch (note.kind) {
    case 'no-command':
      return `Server not started — no command for ${ENV_LABELS[note.env]}`
    case 'needs-variant':
      return note.asked
        ? 'Server not started yet — waiting for a variant choice'
        : 'Server not started — its command needs a variant and none is known'
    case 'plan-failed':
      return 'Server not started — its command could not be resolved'
    case 'no-main-worktree':
      return 'Server not started — the repo has no main worktree for its Spotlight terminal'
    case 'prepare-failed':
      return note.refused
        ? 'Server not started — Spotlight was no longer active when its line was prepared'
        : 'Server not started — preparing its line for the new terminal failed'
    case 'queued':
      return line
        ? `Server queued for a new Spotlight terminal ("${line}")`
        : 'Server queued for a new Spotlight terminal'
    case 'queued-started':
      return spotlightServerStartedNote(line ?? 'queued line')
    case 'queued-dropped':
      return `Queued server line dropped — ${DROP_REASONS[note.reason]}`
    case 'start-failed':
      return `Server not started — ${START_FAILURES[note.reason]}`
  }
}
