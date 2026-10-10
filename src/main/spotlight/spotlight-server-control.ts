// Starts a repo's dev server by typing into its Spotlight terminal's PTY, or queues it for a
// terminal that must spawn; restarts are in spotlight-server-restart.ts, turning Spotlight off stops
// it (spotlight-server-turn-off.ts).
// Local-only: the log capture that owns the terminal exists only for local repos.
import type { SpotlightServerStartResult } from '../../shared/spotlight'
import { SPOTLIGHT_STRAY_CHILD_PERSIST_MS } from '../../shared/spotlight-stray-startup'
import { getLocalPtyProvider } from '../ipc/pty'
import {
  getSpotlightTerminal,
  restartSpotlightTerminalServer,
  stopSpotlightLogCapture
} from './spotlight-log-mirror'
import {
  chainSpotlightInstall,
  markSpotlightInstallPending,
  rememberSpotlightRoot,
  takeSpotlightLaunchInstall
} from './spotlight-lockfile-install'
import {
  clearSpotlightServerLaunched,
  getPreparedSpotlightLaunchPhase,
  getSpotlightServerLaunchedCommand,
  isSpotlightServerTypedWithin,
  markPreparedSpotlightLaunchRegistered,
  markSpotlightServerLaunched,
  markSpotlightServerTyped,
  notePreparedSpotlightLaunchReading,
  rememberPreparedSpotlightLaunch,
  rememberSpotlightServerCommand,
  setPreparedSpotlightLaunchLine,
  takePreparedSpotlightLaunch,
  type PreparedSpotlightLaunchPhase
} from './spotlight-server-commands'
import {
  rememberSpotlightTerminalShell,
  resolveSpotlightQueuedLaunchShell
} from './spotlight-terminal-shell'
import {
  readSpotlightTerminal,
  readSpotlightTerminalForStart,
  type SpotlightStartReading,
  type SpotlightTerminalReading
} from './spotlight-terminal-inspection'
import {
  noteSpotlightServerStarted,
  noteSpotlightStartSkipped,
  type SpotlightStartSkip
} from './spotlight-server-start-notes'

// A line Orca just typed still shows the shell in the foreground until the shell forks it.
const LAUNCH_GRACE_MS = 2000
// Past the renderer's 30 s claim window an unregistered queued launch was dropped, not delayed.
export const SPOTLIGHT_QUEUED_LAUNCH_MAX_WAIT_MS = 35_000
// How often a registered terminal is read until its queued line is seen running.
const QUEUED_LAUNCH_OBSERVE_MS = 1000

const BUSY: SpotlightServerStartResult = { ok: true, started: false, reason: 'busy' }

// Why: overlapping starts (activation, environment switch, unclaimed startup) could each see the
// idle shell and type, landing the second line in the first server's stdin.
const serverOpsByRepoId = new Map<string, Promise<unknown>>()

/** Runs `op` after the repo's earlier server operations settle (start, lockfile restart). */
export function serializeServerOp<T>(repoId: string, op: () => Promise<T>): Promise<T> {
  const previous = serverOpsByRepoId.get(repoId)
  const next = previous ? previous.then(op, op) : op()
  const settled = next.then(
    () => undefined,
    () => undefined
  )
  serverOpsByRepoId.set(repoId, settled)
  void settled.then(() => {
    if (serverOpsByRepoId.get(repoId) === settled) {
      serverOpsByRepoId.delete(repoId)
    }
  })
  return next
}

/** One non-empty line only: control bytes typed into the PTY would act as keystrokes. */
export function normalizeSpotlightServerCommand(command: unknown): string | null {
  if (typeof command !== 'string') {
    return null
  }
  const trimmed = command.trim()
  const hasControlChar = Array.from(trimmed).some((char) => {
    const code = char.charCodeAt(0)
    return code < 0x20 || code === 0x7f
  })
  return trimmed && !hasControlChar ? trimmed : null
}

/** Orca typed a line moments ago: the terminal counts as busy whatever the check says. */
export function isSpotlightLaunchSettling(repoId: string): boolean {
  return isSpotlightServerTypedWithin(repoId, LAUNCH_GRACE_MS)
}

export function writeToSpotlightTerminal(ptyId: string, data: string): boolean {
  try {
    return getLocalPtyProvider().write(ptyId, data) !== false
  } catch {
    return false
  }
}

/** Type `command` into the repo's Spotlight terminal when it is idle; a busy terminal (e.g.
 *  a server started by hand) is left alone. The command is kept for later restarts.
 *  `restartIfDifferent`: a busy terminal running Orca's own server for another command is
 *  restarted with this one (a takeover into another environment). A terminal whose PTY no longer
 *  exists stops being mirrored and answers `terminal-gone`. */
export function startSpotlightServer(args: {
  repoId: string
  command: string
  restartIfDifferent?: boolean
}): Promise<SpotlightServerStartResult> {
  const command = normalizeSpotlightServerCommand(args.command)
  if (!command) {
    return Promise.resolve({ ok: false, reason: 'invalid-command' })
  }
  return serializeServerOp(args.repoId, () =>
    startServerNow(args.repoId, command, args.restartIfDifferent === true)
  )
}

async function startServerNow(
  repoId: string,
  command: string,
  restartIfDifferent: boolean
): Promise<SpotlightServerStartResult> {
  const terminal = getSpotlightTerminal(repoId)
  if (!terminal) {
    return { ok: false, reason: 'no-terminal' }
  }
  rememberSpotlightServerCommand(repoId, command)
  rememberSpotlightRoot(repoId, terminal.rootPath)
  const skip = (why: SpotlightStartSkip): SpotlightServerStartResult => {
    noteSpotlightStartSkipped(terminal.rootPath, why)
    return BUSY
  }
  // A queued line may not have reached its shell yet: typing would add a second line, and a
  // restart would Ctrl-C a shell that is still starting. Neither until it ran or was cancelled.
  const queued = getQueuedSpotlightLaunchPhase(repoId)
  if (queued === 'unregistered' || queued === 'settling') {
    return skip('queued-line')
  }
  const checked = !terminal.restartPending && !isSpotlightLaunchSettling(repoId)
  // A restored tab may hold a PTY that no longer exists, which reads gone; its tab must respawn.
  const reading: SpotlightStartReading = checked
    ? await readSpotlightTerminalForStart(terminal.ptyId)
    : { kind: 'unknown' }
  // Re-read after the check: Spotlight may have turned off or the PTY been replaced meanwhile.
  const current = getSpotlightTerminal(repoId)
  if (current?.ptyId !== terminal.ptyId) {
    return { ok: false, reason: 'no-terminal' }
  }
  if (reading.kind === 'gone') {
    stopSpotlightLogCapture({ repoId, ptyId: terminal.ptyId })
    noteSpotlightStartSkipped(terminal.rootPath, 'terminal-gone')
    return { ok: false, reason: 'terminal-gone' }
  }
  // Only busy readings that persist show the queued line ran; until then the shell may be starting.
  if (queued === 'pending' && !noteQueuedLaunchReading(repoId, reading)) {
    return skip('queued-line')
  }
  // A restart that started during the check re-runs the command itself.
  if (current.restartPending) {
    return skip('restart')
  }
  if (reading.kind !== 'idle') {
    const replaced = restartIfDifferent ? replaceOrcaServer(repoId, command) : null
    if (replaced === 'in-flight') {
      return skip('restart')
    }
    return replaced ?? skip(busySkip(repoId, command, reading))
  }
  const idleShell = reading.shell
  if (idleShell) {
    rememberSpotlightTerminalShell(repoId, idleShell)
  }
  const { install, pendingTaken } = takeSpotlightLaunchInstall(repoId)
  const launch = install ? chainSpotlightInstall(command, idleShell) : command
  if (!writeToSpotlightTerminal(terminal.ptyId, `${launch}\r`)) {
    // The install never reached the terminal; keep it for the next command Orca types.
    if (pendingTaken) {
      markSpotlightInstallPending(repoId)
    }
    return { ok: false, reason: 'no-terminal' }
  }
  markSpotlightServerTyped(repoId, command)
  noteSpotlightServerStarted(terminal.rootPath, launch)
  return { ok: true, started: true }
}

function busySkip(
  repoId: string,
  command: string,
  reading: SpotlightTerminalReading
): SpotlightStartSkip {
  if (isSpotlightLaunchSettling(repoId)) {
    return 'just-typed'
  }
  if (reading.kind === 'unknown') {
    return 'unreadable'
  }
  return getSpotlightServerLaunchedCommand(repoId) === command ? 'orca-server' : 'busy'
}

/** Busy terminal: restart only Orca's own server, and only for a different command. A server
 *  started by hand is never touched; the same command keeps running (hot reload covers code).
 *  Null when it was left alone; `in-flight` when a restart already runs. */
function replaceOrcaServer(
  repoId: string,
  command: string
): SpotlightServerStartResult | 'in-flight' | null {
  const running = getSpotlightServerLaunchedCommand(repoId)
  if (running === undefined || running === command) {
    return null
  }
  const outcome = restartSpotlightTerminalServer(repoId, 'by Orca')
  if (outcome === 'no-terminal') {
    return { ok: false, reason: 'no-terminal' }
  }
  return outcome === 'sent' ? { ok: true, started: true, restarted: true } : outcome
}

/** For a Spotlight terminal whose PTY doesn't exist yet: the caller queues the returned text as
 *  its startup command. Keeps the command for restarts and consumes a pending install (or installs
 *  into a root without node_modules); call `cancelPreparedSpotlightServerLaunch` if the text never
 *  runs. Until the registered terminal is seen running it (or a cap passes), starts count the
 *  terminal as busy. */
export async function prepareSpotlightServerLaunch(
  repoId: string,
  command: string
): Promise<string | null> {
  const normalized = normalizeSpotlightServerCommand(command)
  if (!normalized) {
    return null
  }
  // Before the await: Spotlight turning off meanwhile then forgets all of it.
  rememberSpotlightServerCommand(repoId, normalized)
  markSpotlightServerLaunched(repoId, normalized)
  const terminalRoot = getSpotlightTerminal(repoId)?.rootPath
  if (terminalRoot) {
    rememberSpotlightRoot(repoId, terminalRoot)
  }
  const { install, pendingTaken } = takeSpotlightLaunchInstall(repoId)
  rememberPreparedSpotlightLaunch(repoId, { command: normalized, installTaken: pendingTaken })
  if (!install) {
    return normalized
  }
  const line = chainSpotlightInstall(normalized, await resolveSpotlightQueuedLaunchShell())
  setPreparedSpotlightLaunchLine(repoId, normalized, line)
  return line
}

/** The text `prepareSpotlightServerLaunch` returned will never run (its queue entry was dropped, or
 *  the PTY bound first): stop counting it as Orca's server and put back the install it took. */
export function cancelPreparedSpotlightServerLaunch(repoId: string): void {
  const prepared = takePreparedSpotlightLaunch(repoId)
  if (!prepared) {
    return
  }
  if (getSpotlightServerLaunchedCommand(repoId) === prepared.command) {
    clearSpotlightServerLaunched(repoId)
  }
  if (prepared.installTaken) {
    markSpotlightInstallPending(repoId)
  }
}

/** Where the repo's queued line stands; null once there's none to wait for (ran, cancelled, capped). */
export function getQueuedSpotlightLaunchPhase(repoId: string): PreparedSpotlightLaunchPhase | null {
  return getPreparedSpotlightLaunchPhase(
    repoId,
    LAUNCH_GRACE_MS,
    SPOTLIGHT_QUEUED_LAUNCH_MAX_WAIT_MS
  )
}

function noteQueuedLaunchReading(repoId: string, reading: SpotlightTerminalReading): boolean {
  return notePreparedSpotlightLaunchReading(
    repoId,
    reading.kind === 'busy',
    SPOTLIGHT_STRAY_CHILD_PERSIST_MS
  )
}

/** A PTY registered as the repo's Spotlight terminal, so a queued line now has a shell to run in.
 *  Reads it now and then until that line is seen running, so a later turn-off knows it ran. Also
 *  remembers its root, for the dependency check of a restart's re-run. */
export function trackRegisteredSpotlightLaunch(repoId: string, ptyId: string): void {
  const terminal = getSpotlightTerminal(repoId)
  if (terminal?.ptyId === ptyId) {
    rememberSpotlightRoot(repoId, terminal.rootPath)
  }
  if (!markPreparedSpotlightLaunchRegistered(repoId)) {
    return
  }
  const awaitingRun = (): boolean => {
    const phase = getQueuedSpotlightLaunchPhase(repoId)
    const registered = phase === 'settling' || phase === 'pending'
    return registered && getSpotlightTerminal(repoId)?.ptyId === ptyId
  }
  const observe = async (): Promise<void> => {
    if (!awaitingRun()) {
      return
    }
    const reading = await readSpotlightTerminal(ptyId)
    if (awaitingRun() && !noteQueuedLaunchReading(repoId, reading)) {
      setTimeout(() => void observe(), QUEUED_LAUNCH_OBSERVE_MS)
    }
  }
  setTimeout(() => void observe(), QUEUED_LAUNCH_OBSERVE_MS)
}
