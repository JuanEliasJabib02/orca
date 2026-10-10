// What the repo's Spotlight terminal runs, read through the local PTY provider.
import { withTimeout } from '../../shared/promise-timeout-fallback'
import type { SpotlightServerState } from '../../shared/spotlight'
import { isShellProcess } from '../../shared/shell-process-detection'
import { isClientOnlyUnverifiableInspection } from '../../shared/terminal-process-inspection'
import { getLocalPtyProvider } from '../ipc/pty'
import { readPtyForegroundGroupFallback } from '../providers/pty-foreground-group-fallback'
import { inspectPtyProviderProcess } from '../providers/pty-process-inspection'

// Bound the foreground inspection so Spotlight off can't hang on an unresponsive PTY host.
const INSPECTION_TIMEOUT_MS = 3000
// A daemon session attaches within a few round trips; past this the start reads it as it is.
const ATTACH_WAIT_MS = 3000
const ATTACH_POLL_MS = 50

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
  const provider = getLocalPtyProvider()
  const inspection = await inspectPtyProviderProcess(provider, ptyId, {
    observeForegroundGroup: true
  })
  if (isClientOnlyUnverifiableInspection(inspection)) {
    return UNKNOWN
  }
  // Login shells report as `-zsh`.
  const foreground = inspection.foregroundProcess?.replace(/^-/, '') || null
  const idle: SpotlightTerminalReading = {
    kind: 'idle',
    shell: foreground && isShellProcess(foreground) ? foreground : null
  }
  if (inspection.foregroundGroup === 'shell') {
    return idle
  }
  if (inspection.foregroundGroup === 'job') {
    return BUSY
  }
  // A host that predates the group reading: a name or children prove busy without a capture...
  const named = foreground !== null && !isShellProcess(foreground)
  const children =
    inspection.hasChildProcesses && inspection.childProcessEvidence !== 'unverifiable'
  if (named || children) {
    return BUSY
  }
  // ...and only main's own group reading, by the host's rule, proves the prompt free.
  const group = await readPtyForegroundGroupFallback(
    provider,
    ptyId,
    inspection.foregroundProcessEvidence
  )
  return group === 'shell' ? idle : group === 'job' ? BUSY : UNKNOWN
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

/** Whether the PTY host knows the PTY: true/false when it answered, null when it can't say. */
async function probeLiveness(ptyId: string): Promise<boolean | null> {
  const provider = getLocalPtyProvider()
  if (provider.hasPty?.(ptyId) === true) {
    return true
  }
  // Local PTYs live in this process, so their inventory is exact; a daemon is asked.
  const live = provider.probePtyLiveness
    ? await provider.probePtyLiveness(ptyId)
    : provider.hasPty?.(ptyId)
  return live ?? null
}

/** True only when the PTY host answered that this PTY no longer exists; doubt is never death. */
export function isSpotlightTerminalGone(ptyId: string): Promise<boolean> {
  return withTimeout(
    probeLiveness(ptyId).then((live) => live === false),
    INSPECTION_TIMEOUT_MS,
    false
  )
}

async function waitUntilHostTracks(ptyId: string): Promise<void> {
  const deadline = Date.now() + ATTACH_WAIT_MS
  while (getLocalPtyProvider().hasPty?.(ptyId) === false && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, ATTACH_POLL_MS))
  }
}

/** What a start decides on: a reading, or `gone` when the host answered the PTY no longer exists. */
export type SpotlightStartReading = SpotlightTerminalReading | { kind: 'gone' }

/**
 * The reading a server start acts on. Why the wait: after an app restart the daemon adapter tracks a
 * live session only once something attaches it, and the log mirror's attach is still in flight when
 * the start reads, so a free prompt read unknown and nothing was typed (reset and sport-club, AX-3447).
 */
export async function readSpotlightTerminalForStart(ptyId: string): Promise<SpotlightStartReading> {
  let live: boolean | null | undefined
  if (getLocalPtyProvider().hasPty?.(ptyId) === false) {
    live = await withTimeout(probeLiveness(ptyId), INSPECTION_TIMEOUT_MS, null)
    if (live === false) {
      return { kind: 'gone' }
    }
    if (live === true) {
      await waitUntilHostTracks(ptyId)
    }
  }
  const reading = await readSpotlightTerminal(ptyId)
  // Already probed: live a moment ago, or the host can't say, which is never death.
  if (reading.kind !== 'unknown' || live !== undefined) {
    return reading
  }
  return (await isSpotlightTerminalGone(ptyId)) ? { kind: 'gone' } : reading
}
