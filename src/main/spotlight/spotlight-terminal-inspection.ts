// What the repo's Spotlight terminal runs, read through the local PTY provider.
import { withTimeout } from '../../shared/promise-timeout-fallback'
import type { SpotlightServerState } from '../../shared/spotlight'
import { isShellProcess } from '../../shared/shell-process-detection'
import { isClientOnlyUnverifiableInspection } from '../../shared/terminal-process-inspection'
import { getLocalPtyProvider } from '../ipc/pty'
import { inspectPtyProviderProcess } from '../providers/pty-process-inspection'

// Bound the foreground inspection so Spotlight off can't hang on an unresponsive PTY host.
const INSPECTION_TIMEOUT_MS = 3000

/** `idle`: the shell provably owns the foreground (`shell` is its name when the host gave one).
 *  `busy`: something else runs there. `unknown`: the check failed, timed out, or proves neither. */
export type SpotlightTerminalReading =
  | { kind: 'idle'; shell: string | null }
  | { kind: 'busy' }
  | { kind: 'unknown' }

const BUSY: SpotlightTerminalReading = { kind: 'busy' }
const UNKNOWN: SpotlightTerminalReading = { kind: 'unknown' }

/** Process groups decide: a `sh` shim (`pnpm`) or a bash script in front is busy, though its
 *  name is a shell's. */
async function inspectPosix(ptyId: string): Promise<SpotlightTerminalReading> {
  const inspection = await inspectPtyProviderProcess(getLocalPtyProvider(), ptyId, {
    observeForegroundGroup: true
  })
  if (isClientOnlyUnverifiableInspection(inspection)) {
    return UNKNOWN
  }
  // Login shells report as `-zsh`.
  const foreground = inspection.foregroundProcess?.replace(/^-/, '') || null
  if (inspection.foregroundGroup === 'shell') {
    return { kind: 'idle', shell: foreground && isShellProcess(foreground) ? foreground : null }
  }
  if (inspection.foregroundGroup === 'job') {
    return BUSY
  }
  // A host that predates the group reading can still prove busy, never idle.
  const named = foreground !== null && !isShellProcess(foreground)
  const children =
    inspection.hasChildProcesses && inspection.childProcessEvidence !== 'unverifiable'
  return named || children ? BUSY : UNKNOWN
}

async function inspectWindows(ptyId: string): Promise<SpotlightTerminalReading> {
  const provider = getLocalPtyProvider()
  // Both reads: the daemon derives "no children" from a foreground it may not have read.
  if (await provider.hasChildProcesses(ptyId)) {
    return BUSY
  }
  const foreground = await provider.getForegroundProcess(ptyId)
  if (!foreground) {
    return UNKNOWN
  }
  if (!isShellProcess(foreground)) {
    return BUSY
  }
  // Why: ConPTY reports the spawned shell's name whatever runs (the spawn-file fallback), so on
  // Windows only the host's ownership proof shows the prompt is free; without one it's unverifiable.
  const confirmed = (await provider.confirmShellForeground?.(ptyId)) === true
  return confirmed ? { kind: 'idle', shell: foreground } : UNKNOWN
}

export function readSpotlightTerminal(ptyId: string): Promise<SpotlightTerminalReading> {
  const inspection = process.platform === 'win32' ? inspectWindows(ptyId) : inspectPosix(ptyId)
  return withTimeout(inspection, INSPECTION_TIMEOUT_MS, UNKNOWN)
}

/** The flashlight's answer, from the same reading start and turn-off act on. */
export async function readSpotlightServerState(ptyId: string): Promise<SpotlightServerState> {
  const reading = await readSpotlightTerminal(ptyId)
  return reading.kind === 'busy' ? 'running' : reading.kind === 'idle' ? 'stopped' : 'unknown'
}

async function probeGone(ptyId: string): Promise<boolean> {
  const provider = getLocalPtyProvider()
  if (provider.hasPty?.(ptyId) === true) {
    return false
  }
  // Local PTYs live in this process, so their inventory is exact; a daemon is asked.
  const live = provider.probePtyLiveness
    ? await provider.probePtyLiveness(ptyId)
    : provider.hasPty?.(ptyId)
  return live === false
}

/** True only when the PTY host answered that this PTY no longer exists; doubt is never death. */
export function isSpotlightTerminalGone(ptyId: string): Promise<boolean> {
  return withTimeout(probeGone(ptyId), INSPECTION_TIMEOUT_MS, false)
}
