// Starts, restarts and stops a repo's dev server by typing into its Spotlight terminal's PTY.
// Local-only: the log capture that owns the terminal exists only for local repos.
import type {
  SpotlightServerRestartResult,
  SpotlightServerStartResult
} from '../../shared/spotlight'
import { withTimeout } from '../../shared/promise-timeout-fallback'
import { isShellProcess } from '../../shared/shell-process-detection'
import { getLocalPtyProvider } from '../ipc/pty'
import {
  appendSpotlightLogNote,
  getSpotlightTerminal,
  reclaimSpotlightTerminal,
  releaseSpotlightTerminal,
  restartSpotlightTerminalServer
} from './spotlight-log-mirror'
import {
  chainSpotlightInstall,
  clearSpotlightInstallPending,
  isSpotlightInstallPending,
  markSpotlightInstallPending,
  takeSpotlightInstallPending,
  takeSpotlightLaunchLine
} from './spotlight-lockfile-install'
import {
  clearSpotlightServerLaunched,
  forgetSpotlightServerCommand,
  getSpotlightServerLaunchedCommand,
  isPreparedSpotlightLaunchStarting,
  isSpotlightServerTypedWithin,
  markSpotlightServerLaunched,
  markSpotlightServerTyped,
  rememberPreparedSpotlightLaunch,
  rememberSpotlightServerCommand,
  takePreparedSpotlightLaunch
} from './spotlight-server-commands'
import {
  forgetSpotlightTerminalShell,
  rememberSpotlightTerminalShell,
  resolveSpotlightQueuedLaunchShell
} from './spotlight-terminal-shell'

// Bound the foreground inspection so Spotlight off can't hang on an unresponsive PTY host.
const BUSY_CHECK_TIMEOUT_MS = 3000
// A line Orca just typed still shows the shell in the foreground until the shell forks it.
const LAUNCH_GRACE_MS = 2000
// Past the renderer's 30 s claim window an unregistered queued launch was dropped, not delayed.
const QUEUED_LAUNCH_MAX_WAIT_MS = 35_000

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

async function inspectIdleShell(ptyId: string): Promise<string | null> {
  const provider = getLocalPtyProvider()
  // Both reads: the daemon derives "no children" from a foreground it may not have read, and a
  // degraded local Windows scan reports the shell's name while a child runs.
  if (await provider.hasChildProcesses(ptyId)) {
    return null
  }
  // Login shells report as `-zsh`.
  const foreground = (await provider.getForegroundProcess(ptyId))?.replace(/^-/, '')
  return foreground && isShellProcess(foreground) ? foreground : null
}

/** The shell's name when it provably owns the foreground, else null: something runs there, or
 *  the check failed, timed out or got no answer. */
function findIdleShell(ptyId: string): Promise<string | null> {
  return withTimeout(inspectIdleShell(ptyId), BUSY_CHECK_TIMEOUT_MS, null)
}

/** Orca typed a line moments ago: the terminal counts as busy whatever the check says. */
function isLaunchSettling(repoId: string): boolean {
  return isSpotlightServerTypedWithin(repoId, LAUNCH_GRACE_MS)
}

function writeToTerminal(ptyId: string, data: string): boolean {
  try {
    return getLocalPtyProvider().write(ptyId, data) !== false
  } catch {
    return false
  }
}

/** Type `command` into the repo's Spotlight terminal when it is idle; a busy terminal (e.g.
 *  a server started by hand) is left alone. The command is kept for later restarts.
 *  `restartIfDifferent`: a busy terminal running Orca's own server for another command is
 *  restarted with this one (a takeover into another environment). */
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
  // A queued line may not have reached its shell yet: typing would add a second line, and a
  // restart would Ctrl-C a shell that is still starting. Neither until it ran or was cancelled.
  if (isPreparedSpotlightLaunchStarting(repoId, LAUNCH_GRACE_MS, QUEUED_LAUNCH_MAX_WAIT_MS)) {
    return BUSY
  }
  const idleShell =
    terminal.restartPending || isLaunchSettling(repoId) ? null : await findIdleShell(terminal.ptyId)
  // Re-read after the check: Spotlight may have turned off or the PTY been replaced meanwhile.
  const current = getSpotlightTerminal(repoId)
  if (current?.ptyId !== terminal.ptyId) {
    return { ok: false, reason: 'no-terminal' }
  }
  // A restart that started during the check re-runs the command itself.
  if (current.restartPending) {
    return BUSY
  }
  if (!idleShell) {
    return restartIfDifferent ? replaceOrcaServer(repoId, command) : BUSY
  }
  rememberSpotlightTerminalShell(repoId, idleShell)
  const launch = takeSpotlightLaunchLine(repoId, command, idleShell)
  if (!writeToTerminal(terminal.ptyId, `${launch}\r`)) {
    // The install never reached the terminal; keep it for the next command Orca types.
    if (launch !== command) {
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
 *  its startup command. Keeps the command for restarts and consumes a pending install; call
 *  `cancelPreparedSpotlightServerLaunch` if the text never runs. Until the PTY registers (and a
 *  grace after it), starts count the terminal as busy. */
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
  const installTaken = takeSpotlightInstallPending(repoId)
  rememberPreparedSpotlightLaunch(repoId, { command: normalized, installTaken })
  if (!installTaken) {
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
    (!isLaunchSettling(repoId) && (await findIdleShell(terminal.ptyId)))
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

/** Spotlight is turning off: block further server writes (a pending restart's re-run included)
 *  and Ctrl-C the terminal unless its shell provably idles at the prompt; an unknown state gets
 *  the Ctrl-C too, harmless at a prompt. Await before restoring the root. */
export function interruptSpotlightServer(repoId: string): Promise<boolean> {
  return interruptTerminal(repoId, isLaunchSettling(repoId))
}

async function interruptTerminal(repoId: string, launchSettling: boolean): Promise<boolean> {
  const terminal = releaseSpotlightTerminal(repoId)
  if (!terminal || (!launchSettling && (await findIdleShell(terminal.ptyId)))) {
    return false
  }
  if (!writeToTerminal(terminal.ptyId, '\x03')) {
    return false
  }
  void appendSpotlightLogNote(terminal.rootPath, 'Spotlight off — server stopped (interrupt sent)')
  return true
}

/** Turning Spotlight off failed after `interruptSpotlightServer`: Spotlight stays on with its
 *  server stopped, so hand the terminal back to server control and say so in the log. */
export function resumeSpotlightServerControl(repoId: string, rootPath: string): void {
  reclaimSpotlightTerminal(repoId)
  void appendSpotlightLogNote(
    rootPath,
    'Spotlight off failed — Spotlight is still on, but its server was stopped; start it again'
  )
}

/** Spotlight off: forget the command, a pending install and a queued launch, then interrupt. */
export function stopSpotlightServer(repoId: string): Promise<boolean> {
  // Read before forgetting: a line typed moments ago still needs the Ctrl-C.
  const launchSettling = isLaunchSettling(repoId)
  forgetSpotlightServerCommand(repoId)
  forgetSpotlightTerminalShell(repoId)
  clearSpotlightInstallPending(repoId)
  return interruptTerminal(repoId, launchSettling)
}
