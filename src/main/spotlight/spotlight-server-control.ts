// Starts, restarts and stops a repo's dev server by typing into its Spotlight terminal's PTY.
// Local-only: the log capture that owns the terminal exists only for local repos.
import type {
  SpotlightServerRestartResult,
  SpotlightServerStartResult
} from '../../shared/spotlight'
import { withTimeout } from '../../shared/promise-timeout-fallback'
import { getLocalPtyProvider } from '../ipc/pty'
import {
  appendSpotlightLogNote,
  getSpotlightTerminal,
  releaseSpotlightTerminal,
  restartSpotlightTerminalServer
} from './spotlight-log-mirror'
import {
  clearSpotlightInstallPending,
  isSpotlightInstallPending,
  markSpotlightInstallPending,
  takeSpotlightInstallPrefix
} from './spotlight-lockfile-install'
import {
  forgetSpotlightServerCommand,
  getSpotlightServerCommand,
  getSpotlightServerLaunchedCommand,
  markSpotlightServerLaunched,
  rememberSpotlightServerCommand
} from './spotlight-server-commands'

// Bound the foreground inspection so Spotlight off can't hang on an unresponsive PTY host.
const BUSY_CHECK_TIMEOUT_MS = 3000

const BUSY: SpotlightServerStartResult = { ok: true, started: false, reason: 'busy' }

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

/** A failed or slow foreground check counts as busy, so Orca never types into a running process. */
async function isTerminalBusy(ptyId: string): Promise<boolean> {
  try {
    return await withTimeout(
      getLocalPtyProvider().hasChildProcesses(ptyId),
      BUSY_CHECK_TIMEOUT_MS,
      true
    )
  } catch {
    return true
  }
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
export async function startSpotlightServer(args: {
  repoId: string
  command: string
  restartIfDifferent?: boolean
}): Promise<SpotlightServerStartResult> {
  const command = normalizeSpotlightServerCommand(args.command)
  if (!command) {
    return { ok: false, reason: 'invalid-command' }
  }
  const terminal = getSpotlightTerminal(args.repoId)
  if (!terminal) {
    return { ok: false, reason: 'no-terminal' }
  }
  rememberSpotlightServerCommand(args.repoId, command)
  const busy = terminal.restartPending || (await isTerminalBusy(terminal.ptyId))
  // Re-read after the check: Spotlight may have turned off or the PTY been replaced meanwhile.
  const current = getSpotlightTerminal(args.repoId)
  if (current?.ptyId !== terminal.ptyId) {
    return { ok: false, reason: 'no-terminal' }
  }
  // A restart that started during the check re-runs the command itself.
  if (current.restartPending) {
    return BUSY
  }
  if (busy) {
    return args.restartIfDifferent ? replaceOrcaServer(args.repoId, command) : BUSY
  }
  const launch = `${takeSpotlightInstallPrefix(args.repoId)}${command}`
  if (!writeToTerminal(terminal.ptyId, `${launch}\r`)) {
    // The install never reached the terminal; keep it for the next command Orca types.
    if (launch !== command) {
      markSpotlightInstallPending(args.repoId)
    }
    return { ok: false, reason: 'no-terminal' }
  }
  markSpotlightServerLaunched(args.repoId, command)
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
 *  its startup command. Keeps the command for restarts and consumes a pending install. */
export function prepareSpotlightServerLaunch(repoId: string, command: string): string | null {
  const normalized = normalizeSpotlightServerCommand(command)
  if (!normalized) {
    return null
  }
  rememberSpotlightServerCommand(repoId, normalized)
  markSpotlightServerLaunched(repoId, normalized)
  return `${takeSpotlightInstallPrefix(repoId)}${normalized}`
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

/** pnpm-lock.yaml changed under a running server: restart it so its re-run installs first. A server
 *  Orca didn't start (no stored command) can't be re-run, so the change is only noted in the log. */
export async function restartSpotlightServerForLockfileChange(repoId: string): Promise<void> {
  const terminal = getSpotlightTerminal(repoId)
  // A restart between interrupt and re-run already installs on its re-run; idle waits for a start.
  if (!terminal || terminal.restartPending || !(await isTerminalBusy(terminal.ptyId))) {
    return
  }
  // Re-read after the check: Spotlight may have turned off, or a start already took the install.
  if (
    getSpotlightTerminal(repoId)?.ptyId !== terminal.ptyId ||
    !isSpotlightInstallPending(repoId)
  ) {
    return
  }
  if (getSpotlightServerCommand(repoId)) {
    restartSpotlightTerminalServer(repoId, 'after a pnpm-lock.yaml change')
    return
  }
  void appendSpotlightLogNote(
    terminal.rootPath,
    'pnpm-lock.yaml changed — stop the server, run "pnpm install", then start it again'
  )
}

/** Spotlight off: Ctrl-C a busy terminal (idle is left alone), forget the command and any pending
 *  install, and block further server writes, a pending restart's re-run included. Await before
 *  tearing the capture down. */
export async function stopSpotlightServer(repoId: string): Promise<boolean> {
  forgetSpotlightServerCommand(repoId)
  clearSpotlightInstallPending(repoId)
  const terminal = releaseSpotlightTerminal(repoId)
  if (!terminal || !(await isTerminalBusy(terminal.ptyId))) {
    return false
  }
  if (!writeToTerminal(terminal.ptyId, '\x03')) {
    return false
  }
  void appendSpotlightLogNote(terminal.rootPath, 'Spotlight off — server stopped (interrupt sent)')
  return true
}
