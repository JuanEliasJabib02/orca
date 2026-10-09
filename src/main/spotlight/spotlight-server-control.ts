// Starts and restarts a repo's dev server by typing into its Spotlight terminal's PTY; turning
// Spotlight off stops it (spotlight-server-turn-off.ts).
// Local-only: the log capture that owns the terminal exists only for local repos.
import type {
  SpotlightServerRestartResult,
  SpotlightServerStartResult
} from '../../shared/spotlight'
import { SPOTLIGHT_STRAY_CHILD_PERSIST_MS } from '../../shared/spotlight-stray-startup'
import { getLocalPtyProvider } from '../ipc/pty'
import {
  appendSpotlightLogNote,
  getSpotlightTerminal,
  restartSpotlightTerminalServer,
  stopSpotlightLogCapture
} from './spotlight-log-mirror'
import {
  chainSpotlightInstall,
  isSpotlightInstallPending,
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
  takePreparedSpotlightLaunch,
  type PreparedSpotlightLaunchPhase
} from './spotlight-server-commands'
import {
  rememberSpotlightTerminalShell,
  resolveSpotlightQueuedLaunchShell
} from './spotlight-terminal-shell'
import {
  isSpotlightTerminalGone,
  readSpotlightTerminal,
  type SpotlightTerminalReading
} from './spotlight-terminal-inspection'

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

function serializeServerOp<T>(repoId: string, op: () => Promise<T>): Promise<T> {
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

/** The shell provably owns the foreground (not busy, not unknown). */
async function readsIdle(ptyId: string): Promise<boolean> {
  return (await readSpotlightTerminal(ptyId)).kind === 'idle'
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
  // A queued line may not have reached its shell yet: typing would add a second line, and a
  // restart would Ctrl-C a shell that is still starting. Neither until it ran or was cancelled.
  const queued = getQueuedSpotlightLaunchPhase(repoId)
  if (queued === 'unregistered' || queued === 'settling') {
    return BUSY
  }
  const checked = !terminal.restartPending && !isSpotlightLaunchSettling(repoId)
  const reading: SpotlightTerminalReading = checked
    ? await readSpotlightTerminal(terminal.ptyId)
    : { kind: 'unknown' }
  // A restored tab may hold a PTY that no longer exists, which reads unknown; its tab must respawn.
  const gone =
    checked && reading.kind === 'unknown' && (await isSpotlightTerminalGone(terminal.ptyId))
  // Re-read after the check: Spotlight may have turned off or the PTY been replaced meanwhile.
  const current = getSpotlightTerminal(repoId)
  if (current?.ptyId !== terminal.ptyId) {
    return { ok: false, reason: 'no-terminal' }
  }
  if (gone) {
    stopSpotlightLogCapture({ repoId, ptyId: terminal.ptyId })
    return { ok: false, reason: 'terminal-gone' }
  }
  // Only busy readings that persist show the queued line ran; until then the shell may be starting.
  if (queued === 'pending' && !noteQueuedLaunchReading(repoId, reading)) {
    return BUSY
  }
  // A restart that started during the check re-runs the command itself.
  if (current.restartPending) {
    return BUSY
  }
  if (reading.kind !== 'idle') {
    return restartIfDifferent ? replaceOrcaServer(repoId, command) : BUSY
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
  void appendSpotlightLogNote(terminal.rootPath, `Server started by Orca ("${launch}")`)
  return { ok: true, started: true }
}

/** Busy terminal: restart only Orca's own server, and only for a different command. A server
 *  started by hand is never touched; the same command keeps running (hot reload covers code). */
function replaceOrcaServer(repoId: string, command: string): SpotlightServerStartResult {
  const running = getSpotlightServerLaunchedCommand(repoId)
  if (running === undefined || running === command) {
    return BUSY
  }
  const outcome = restartSpotlightTerminalServer(repoId, 'by Orca')
  if (outcome === 'no-terminal') {
    return { ok: false, reason: 'no-terminal' }
  }
  return outcome === 'sent' ? { ok: true, started: true, restarted: true } : BUSY
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
  return chainSpotlightInstall(normalized, await resolveSpotlightQueuedLaunchShell())
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

/** Ctrl-C, then re-run `command` (kept for later restarts), else the last one Orca ran, else
 *  the shell's history recall. */
export function restartSpotlightServer(args: {
  repoId: string
  command?: string
}): SpotlightServerRestartResult {
  const command =
    args.command === undefined ? undefined : normalizeSpotlightServerCommand(args.command)
  if (command === null) {
    return { ok: false, reason: 'invalid-command' }
  }
  if (!getSpotlightTerminal(args.repoId)) {
    return { ok: false, reason: 'no-terminal' }
  }
  if (command) {
    rememberSpotlightServerCommand(args.repoId, command)
  }
  const outcome = restartSpotlightTerminalServer(args.repoId, 'by Orca')
  if (outcome === 'no-terminal') {
    return { ok: false, reason: 'no-terminal' }
  }
  return outcome === 'sent'
    ? { ok: true, restarted: true }
    : { ok: true, restarted: false, reason: 'in-flight' }
}

/** pnpm-lock.yaml changed under a running server: restart it so its re-run installs first. Only a
 *  server Orca launched; one started by hand is never interrupted, the change is only noted. */
export function restartSpotlightServerForLockfileChange(repoId: string): Promise<void> {
  return serializeServerOp(repoId, () => restartForLockfileChangeNow(repoId))
}

async function restartForLockfileChangeNow(repoId: string): Promise<void> {
  const terminal = getSpotlightTerminal(repoId)
  // A restart between interrupt and re-run already installs on its re-run; idle waits for a start.
  if (
    !terminal ||
    terminal.restartPending ||
    (!isSpotlightLaunchSettling(repoId) && (await readsIdle(terminal.ptyId)))
  ) {
    return
  }
  // Re-read after the check: Spotlight may have turned off, or a queued launch took the install.
  if (
    getSpotlightTerminal(repoId)?.ptyId !== terminal.ptyId ||
    !isSpotlightInstallPending(repoId)
  ) {
    return
  }
  if (getSpotlightServerLaunchedCommand(repoId)) {
    restartSpotlightTerminalServer(repoId, 'after a pnpm-lock.yaml change')
    return
  }
  void appendSpotlightLogNote(
    terminal.rootPath,
    'pnpm-lock.yaml changed — stop the server, run "pnpm install", then start it again'
  )
}
