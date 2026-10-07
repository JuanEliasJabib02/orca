// What the repo's Spotlight terminal runs, read through the local PTY provider.
import { withTimeout } from '../../shared/promise-timeout-fallback'
import { isShellProcess } from '../../shared/shell-process-detection'
import { getLocalPtyProvider } from '../ipc/pty'

// Bound the foreground inspection so Spotlight off can't hang on an unresponsive PTY host.
const INSPECTION_TIMEOUT_MS = 3000

/** `idle`: the shell provably owns the foreground. `busy`: a process was seen running there.
 *  `unknown`: the check failed, timed out, or read something that proves neither. */
export type SpotlightTerminalReading =
  | { kind: 'idle'; shell: string }
  | { kind: 'busy' }
  | { kind: 'unknown' }

const BUSY: SpotlightTerminalReading = { kind: 'busy' }
const UNKNOWN: SpotlightTerminalReading = { kind: 'unknown' }

async function inspect(ptyId: string): Promise<SpotlightTerminalReading> {
  const provider = getLocalPtyProvider()
  // Both reads: the daemon derives "no children" from a foreground it may not have read.
  if (await provider.hasChildProcesses(ptyId)) {
    return BUSY
  }
  // Login shells report as `-zsh`.
  const foreground = (await provider.getForegroundProcess(ptyId))?.replace(/^-/, '')
  if (!foreground) {
    return UNKNOWN
  }
  if (!isShellProcess(foreground)) {
    return BUSY
  }
  if (process.platform !== 'win32') {
    return { kind: 'idle', shell: foreground }
  }
  // Why: ConPTY reports the spawned shell's name whatever runs (the spawn-file fallback), so on
  // Windows only the host's ownership proof shows the prompt is free; without one it's unverifiable.
  const confirmed = (await provider.confirmShellForeground?.(ptyId)) === true
  return confirmed ? { kind: 'idle', shell: foreground } : UNKNOWN
}

export function readSpotlightTerminal(ptyId: string): Promise<SpotlightTerminalReading> {
  return withTimeout(inspect(ptyId), INSPECTION_TIMEOUT_MS, UNKNOWN)
}

/** A process runs in the terminal; a failed or slow check counts as none. */
export function spotlightTerminalHasChild(ptyId: string): Promise<boolean> {
  return withTimeout(
    Promise.resolve().then(() => getLocalPtyProvider().hasChildProcesses(ptyId)),
    INSPECTION_TIMEOUT_MS,
    false
  )
}
