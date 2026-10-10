import { ipcMain } from 'electron'
import type { BrowserWindow } from 'electron'
import type { SpotlightServerStartResult, SpotlightServerState } from '../../shared/spotlight'
import { parseSpotlightAutostartNote } from '../../shared/spotlight-autostart-note'
import type { Store } from '../persistence'
import { SpotlightService } from '../spotlight/spotlight-service'
import {
  getSpotlightTerminal,
  startSpotlightLogCapture,
  stopSpotlightLogCapture
} from '../spotlight/spotlight-log-mirror'
import {
  cancelPreparedSpotlightServerLaunch,
  prepareSpotlightServerLaunch,
  startSpotlightServer,
  trackRegisteredSpotlightLaunch
} from '../spotlight/spotlight-server-control'
import { noteSpotlightAutostart } from '../spotlight/spotlight-server-start-notes'
import { watchLateSpotlightTerminal } from '../spotlight/spotlight-server-turn-off'
import { configureSpotlightTerminalShell } from '../spotlight/spotlight-terminal-shell'
import { readSpotlightServerState } from '../spotlight/spotlight-terminal-inspection'
import {
  configureSpotlightTerminalOutputSource,
  type SpotlightTerminalOutputSource
} from '../spotlight/spotlight-terminal-output-source'
import { registerSpotlightVariantHandler } from './spotlight-variant-handler'

// Module singleton with a mutable window ref: attachMainWindowServices re-runs on
// macOS dock re-activation, and rebuilding the service would drop its per-repo
// mutex while old git operations are still in flight — letting two instances race
// destructive git on the same root. One service per process; only retarget the window.
let service: SpotlightService | null = null
let currentWindow: BrowserWindow | null = null
let reconciled = false

/** Turn Spotlight off before a repo/holder is torn down, so the root doesn't
 *  stay detached on the snapshot with the log capture leaked. No-op when the
 *  repo isn't holding the Spotlight. Deactivate is idempotent and swallows its
 *  own errors, so callers (repo removal, worktree deletion) can await it
 *  unconditionally without failing the teardown. */
export async function deactivateSpotlightBeforeTeardown(repoId: string): Promise<void> {
  if (!service || !service.getState(repoId)) {
    return
  }
  await service.deactivate(repoId)
  // If deactivate couldn't finish (merge/rebase in the root, a restore conflict,
  // or a diverged root — no force here on purpose, so direct-root work is
  // preserved rather than reset --hard away), removeProject is about to drop the
  // record — orphaning the refs with no reconcile left to reach them. Force-clean
  // them, keeping the backup ref for manual recovery (original HEAD stays
  // reachable via backup^). No-op when deactivate already cleared the record.
  if (service.getState(repoId)) {
    await service.purgeForTeardown(repoId)
  }
  // Even if deactivate couldn't complete (e.g. a merge/rebase in progress), the
  // repo is being removed — stop the capture so its PTY listener, .orca watcher,
  // and file handle don't leak. No-op when deactivate already stopped it.
  stopSpotlightLogCapture({ repoId })
}

/** Deactivate before the CURRENT holder worktree is deleted, so the root is
 *  restored instead of frozen on a snapshot that points at a worktree about to
 *  vanish (which would silently kill auto-sync and leave the badge lying).
 *  No-op unless this worktree is the active holder. */
export async function deactivateSpotlightIfHolder(
  repoId: string,
  worktreeId: string
): Promise<void> {
  if (!service || service.getState(repoId)?.holderWorktreeId !== worktreeId) {
    return
  }
  // No force on purpose: a diverged root blocks the restore rather than discarding
  // direct-root work, leaving the record active over the deleted holder until the
  // user turns Spotlight off (which offers the force escape). Preserving work wins.
  await service.deactivate(repoId)
  // As above: the holder worktree is about to be deleted, so release the capture
  // even if the restore couldn't complete.
  stopSpotlightLogCapture({ repoId })
}

export function registerSpotlightHandlers(
  mainWindow: BrowserWindow,
  store: Store,
  runtime?: SpotlightTerminalOutputSource
): void {
  currentWindow = mainWindow
  if (!service) {
    service = new SpotlightService(store, () =>
      currentWindow && !currentWindow.isDestroyed() ? currentWindow : null
    )
  }
  const spotlight = service
  configureSpotlightTerminalShell(() => store.getSettings())
  configureSpotlightTerminalOutputSource(runtime ?? null)

  ipcMain.removeHandler('spotlight:getState')
  ipcMain.removeHandler('spotlight:activate')
  ipcMain.removeHandler('spotlight:sync')
  ipcMain.removeHandler('spotlight:deactivate')
  ipcMain.removeHandler('spotlight:setLogPty')
  ipcMain.removeHandler('spotlight:clearLogPty')
  ipcMain.removeHandler('spotlight:startServer')
  ipcMain.removeHandler('spotlight:prepareServerLaunch')
  ipcMain.removeHandler('spotlight:cancelPreparedServerLaunch')
  ipcMain.removeHandler('spotlight:serverState')
  ipcMain.removeHandler('spotlight:noteServerAutostart')

  // Only while Spotlight is actually active for a local repo — the
  // spotlightRepoRoot tab flag persists across sessions, so without this a
  // once-Spotlight terminal would keep being captured (and typed into) after turn-off.
  const isActiveLocalSpotlight = (repoId: string): boolean => {
    const repo = store.getRepo(repoId)
    return Boolean(repo && !repo.connectionId?.trim() && spotlight.getState(repoId))
  }

  ipcMain.handle('spotlight:getState', () => spotlight.getStateSnapshot())
  ipcMain.handle(
    'spotlight:activate',
    (_event, args: { repoId: string; worktreeId: string; force?: boolean }) =>
      spotlight.activate(args.repoId, args.worktreeId, { force: args.force })
  )
  ipcMain.handle('spotlight:sync', (_event, args: { repoId: string; force?: boolean }) =>
    spotlight.sync(args.repoId, { force: args.force })
  )
  ipcMain.handle('spotlight:deactivate', (_event, args: { repoId: string; force?: boolean }) =>
    spotlight.deactivate(args.repoId, { force: args.force })
  )
  ipcMain.handle('spotlight:setLogPty', async (_event, args: { repoId: string; ptyId: string }) => {
    const repo = store.getRepo(args.repoId)
    if (!repo || !isActiveLocalSpotlight(args.repoId)) {
      return
    }
    await startSpotlightLogCapture({ repoId: args.repoId, ptyId: args.ptyId, rootPath: repo.path })
    // Why: a turn-off during the await already ran; don't leave this capture on the restored root.
    if (!isActiveLocalSpotlight(args.repoId)) {
      stopSpotlightLogCapture({ repoId: args.repoId, ptyId: args.ptyId })
      watchLateSpotlightTerminal(args.repoId, args.ptyId)
      return
    }
    // A queued server line now has a shell to run in; starts wait a grace for it to fork.
    trackRegisteredSpotlightLaunch(args.repoId, args.ptyId)
  })
  ipcMain.handle('spotlight:clearLogPty', (_event, args: { repoId: string; ptyId?: string }) => {
    stopSpotlightLogCapture(args)
  })
  ipcMain.handle(
    'spotlight:startServer',
    async (
      _event,
      args: { repoId: string; command: string; restartIfDifferent?: boolean }
    ): Promise<SpotlightServerStartResult> =>
      isActiveLocalSpotlight(args.repoId)
        ? startSpotlightServer({
            repoId: args.repoId,
            command: args.command,
            restartIfDifferent: args.restartIfDifferent === true
          })
        : { ok: false, reason: 'not-active' }
  )
  ipcMain.handle(
    'spotlight:prepareServerLaunch',
    async (_event, args: { repoId: string; command: string }): Promise<string | null> =>
      isActiveLocalSpotlight(args.repoId)
        ? prepareSpotlightServerLaunch(args.repoId, args.command)
        : null
  )
  ipcMain.handle('spotlight:cancelPreparedServerLaunch', (_event, args: { repoId: string }) => {
    if (isActiveLocalSpotlight(args.repoId)) {
      cancelPreparedSpotlightServerLaunch(args.repoId)
    }
  })
  // Only the repo's registered Spotlight terminal: the renderer can't probe arbitrary PTYs here.
  ipcMain.handle(
    'spotlight:serverState',
    async (_event, args: { repoId: string; ptyId: string }): Promise<SpotlightServerState> =>
      isActiveLocalSpotlight(args.repoId) && getSpotlightTerminal(args.repoId)?.ptyId === args.ptyId
        ? readSpotlightServerState(args.ptyId)
        : 'unknown'
  )
  // Main words the line and picks the file (the local root's log), so the renderer sends only a kind.
  ipcMain.handle(
    'spotlight:noteServerAutostart',
    (_event, args: { repoId: string; note: unknown }) => {
      const repo = store.getRepo(args.repoId)
      const note = parseSpotlightAutostartNote(args.note)
      if (repo && !repo.connectionId?.trim() && note) {
        noteSpotlightAutostart(args.repoId, repo.path, note)
      }
    }
  )
  // Reads only the holder's own checkout, so the renderer can't point it at another worktree.
  registerSpotlightVariantHandler(
    store,
    (repoId, worktreeId) =>
      isActiveLocalSpotlight(repoId) && spotlight.getState(repoId)?.holderWorktreeId === worktreeId
  )

  // Why: the git refs are the source of truth and may have changed while Orca
  // was closed (manual git use, crashes). One reconcile pass per app run.
  if (!reconciled) {
    reconciled = true
    void spotlight.reconcileAll().catch((error) => {
      console.warn(
        '[spotlight] Startup reconcile failed:',
        error instanceof Error ? error.message : String(error)
      )
    })
  }
}
