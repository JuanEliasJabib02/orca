// Restarts a repo's Spotlight server: on request (Ctrl-C, then the command again), and after a
// lockfile change under a server Orca launched, so its re-run installs first.
import type { SpotlightServerRestartResult } from '../../shared/spotlight'
import {
  appendSpotlightLogNote,
  getSpotlightTerminal,
  restartSpotlightTerminalServer
} from './spotlight-log-mirror'
import { isSpotlightInstallPending } from './spotlight-lockfile-install'
import {
  getSpotlightServerLaunchedCommand,
  rememberSpotlightServerCommand
} from './spotlight-server-commands'
import {
  isSpotlightLaunchSettling,
  normalizeSpotlightServerCommand,
  serializeServerOp
} from './spotlight-server-control'
import { readSpotlightTerminal } from './spotlight-terminal-inspection'

/** The shell provably owns the foreground (not busy, not unknown). */
async function readsIdle(ptyId: string): Promise<boolean> {
  return (await readSpotlightTerminal(ptyId)).kind === 'idle'
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
