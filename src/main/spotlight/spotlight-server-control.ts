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
  forgetSpotlightServerCommand,
  rememberSpotlightServerCommand
} from './spotlight-server-commands'

// Bound the foreground inspection so Spotlight off can't hang on an unresponsive PTY host.
const BUSY_CHECK_TIMEOUT_MS = 3000

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
 *  a server started by hand) is left alone. The command is kept for later restarts. */
export async function startSpotlightServer(args: {
  repoId: string
  command: string
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
  if (busy || current.restartPending) {
    return { ok: true, started: false, reason: 'busy' }
  }
  if (!writeToTerminal(terminal.ptyId, `${command}\r`)) {
    return { ok: false, reason: 'no-terminal' }
  }
  void appendSpotlightLogNote(terminal.rootPath, `Server started by Orca ("${command}")`)
  return { ok: true, started: true }
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

/** Spotlight off: Ctrl-C a busy terminal (idle is left alone), forget the command, and block
 *  further server writes, a pending restart's re-run included. Await before tearing the capture down. */
export async function stopSpotlightServer(repoId: string): Promise<boolean> {
  forgetSpotlightServerCommand(repoId)
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
