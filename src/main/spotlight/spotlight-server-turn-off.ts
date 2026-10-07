// Spotlight off: interrupts the repo's dev server in its Spotlight terminal, and watches a queued
// server line that may still reach a shell after the turn-off.
import { watchStraySpotlightStartup } from '../../shared/spotlight-stray-startup'
import {
  appendSpotlightLogNote,
  getSpotlightTerminal,
  reclaimSpotlightTerminal,
  releaseSpotlightTerminal
} from './spotlight-log-mirror'
import { clearSpotlightInstallPending } from './spotlight-lockfile-install'
import { forgetSpotlightServerCommand } from './spotlight-server-commands'
import {
  getQueuedSpotlightLaunchPhase,
  isSpotlightLaunchSettling,
  SPOTLIGHT_QUEUED_LAUNCH_MAX_WAIT_MS,
  writeToSpotlightTerminal
} from './spotlight-server-control'
import { readSpotlightTerminal } from './spotlight-terminal-inspection'
import { forgetSpotlightTerminalShell } from './spotlight-terminal-shell'

/** What the turn-off read before forgetting the repo's server state. */
type TurnOffSnapshot = { launchSettling: boolean; queuedLaunchAwaitingRun: boolean }

// A queued line still waiting for its PTY at turn-off: a PTY registering until then may be its shell.
const lateWatchEligibleUntilByRepoId = new Map<string, number>()

function snapshotTurnOff(repoId: string): TurnOffSnapshot {
  const phase = getQueuedSpotlightLaunchPhase(repoId)
  if (phase === 'unregistered') {
    lateWatchEligibleUntilByRepoId.set(repoId, Date.now() + SPOTLIGHT_QUEUED_LAUNCH_MAX_WAIT_MS)
  } else {
    lateWatchEligibleUntilByRepoId.delete(repoId)
  }
  return {
    launchSettling: isSpotlightLaunchSettling(repoId),
    queuedLaunchAwaitingRun: phase === 'settling' || phase === 'pending'
  }
}

/** Spotlight is turning off: block further server writes (a pending restart's re-run included)
 *  and Ctrl-C the terminal unless its shell provably idles at the prompt; an unknown state gets
 *  the Ctrl-C too, harmless at a prompt. Await before restoring the root. True when the Ctrl-C
 *  went out. */
export function interruptSpotlightServer(repoId: string): Promise<boolean> {
  return interruptTerminal(repoId, snapshotTurnOff(repoId))
}

async function interruptTerminal(repoId: string, snapshot: TurnOffSnapshot): Promise<boolean> {
  const terminal = releaseSpotlightTerminal(repoId)
  if (!terminal) {
    return false
  }
  const idle =
    !snapshot.launchSettling && (await readSpotlightTerminal(terminal.ptyId)).kind === 'idle'
  const interrupted = !idle && writeToSpotlightTerminal(terminal.ptyId, '\x03')
  if (snapshot.queuedLaunchAwaitingRun) {
    watchStrayQueuedLaunch(repoId, terminal.ptyId, interrupted)
  }
  if (interrupted) {
    void appendSpotlightLogNote(
      terminal.rootPath,
      'Spotlight off — server stopped (interrupt sent)'
    )
  }
  return interrupted
}

/** The queued line may still wait in the shell's startup, where the shell reads as idle: once it
 *  runs, interrupt it like the renderer does for a PTY main never mirrored. */
function watchStrayQueuedLaunch(repoId: string, ptyId: string, alreadyInterrupted: boolean): void {
  watchStraySpotlightStartup({
    // Unknown can't prove a free prompt (never can on the Windows daemon); Ctrl-C there is harmless.
    isRunning: async () => (await readSpotlightTerminal(ptyId)).kind !== 'idle',
    interrupt: () => writeToSpotlightTerminal(ptyId, '\x03'),
    // Server control owns the terminal again: Spotlight is back on, or turning it off failed.
    shouldStop: () => getSpotlightTerminal(repoId) !== null,
    alreadyInterrupted
  })
}

/** A Spotlight terminal that registered while Spotlight turned off. Watched like a released one only
 *  when the turn-off left a queued line waiting for its PTY (once); any other pane is left alone. */
export function watchLateSpotlightTerminal(repoId: string, ptyId: string): void {
  const eligibleUntil = lateWatchEligibleUntilByRepoId.get(repoId)
  lateWatchEligibleUntilByRepoId.delete(repoId)
  if (eligibleUntil !== undefined && Date.now() < eligibleUntil) {
    watchStrayQueuedLaunch(repoId, ptyId, false)
  }
}

/** Turning Spotlight off failed after `interruptSpotlightServer`: Spotlight stays on, so hand the
 *  terminal back to server control and log whether its server was stopped. */
export function resumeSpotlightServerControl(
  repoId: string,
  rootPath: string,
  serverStopped: boolean
): void {
  reclaimSpotlightTerminal(repoId)
  void appendSpotlightLogNote(
    rootPath,
    serverStopped
      ? 'Spotlight off failed — Spotlight is still on, but its server was stopped; start it again'
      : 'Spotlight off failed — Spotlight is still on'
  )
}

/** Spotlight off: forget the command, a pending install and a queued launch, then interrupt. */
export function stopSpotlightServer(repoId: string): Promise<boolean> {
  // Read before forgetting: a line typed moments ago still needs the Ctrl-C.
  const snapshot = snapshotTurnOff(repoId)
  forgetSpotlightServerCommand(repoId)
  forgetSpotlightTerminalShell(repoId)
  clearSpotlightInstallPending(repoId)
  return interruptTerminal(repoId, snapshot)
}
