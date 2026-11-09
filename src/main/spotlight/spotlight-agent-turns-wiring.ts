import type { BrowserWindow } from 'electron'
import { laneKeyOf } from '../../shared/project-group-space'
import { normalizeSpotlightMaxConcurrentTests } from '../../shared/spotlight-test-queue-settings'
import { getRepoIdFromWorktreeId } from '../../shared/worktree/id'
import { agentHookServer } from '../agent-hooks/server/agent-hook-server'
import { getPtyIdForPaneKey, registerPaneKeyTeardownListener } from '../ipc/pty/pane/key-state'
import type { Store } from '../persistence/loading-store/store'
import type { RuntimeAccountController } from '../runtime/agent-session/environment/runtime-account-controller'
import {
  lightAgentTaskInRenderer,
  resolveAgentTaskInRenderer
} from './spotlight-agent-task-request'
import { readTurnEndFromRows } from './spotlight-agent-turn-pause'
import { isPaneAccountAtLimit, paneTranscriptPath } from './spotlight-agent-turn-usage'
import {
  getSpotlightAgentTurns,
  setSpotlightAgentTurns,
  SpotlightAgentTurns
} from './spotlight-agent-turns'
import { getSpotlightTerminal } from './spotlight-log-mirror'
import type { SpotlightService } from './spotlight-service'
import { readSpotlightServerState } from './spotlight-terminal-inspection'

/** The account services a stopped agent's usage is read from. */
export type SpotlightTurnAccounts = Pick<
  RuntimeAccountController,
  'usageRateLimits' | 'getSnapshot'
>

/** Once per process, like the Spotlight service: turns must outlive a macOS window re-attach. */
export function installSpotlightAgentTurns(args: {
  store: Store
  service: SpotlightService
  getWindow: () => BrowserWindow | null
  /** Null without a runtime: every stopped agent then pauses as `error`. */
  accounts: SpotlightTurnAccounts | null
}): void {
  if (getSpotlightAgentTurns()) {
    return
  }
  const { store } = args
  const requireWindow = (): BrowserWindow => {
    const win = args.getWindow()
    if (!win) {
      throw new Error('The Orca window is not open, so no Spotlight can be lit.')
    }
    return win
  }
  const turns = new SpotlightAgentTurns({
    getRepo: (repoId) => store.getRepo(repoId),
    getSpotlightState: (repoId) => args.service.getState(repoId),
    listSpotlightStates: () => Object.values(args.service.getStateSnapshot().byRepo),
    // Why async: a closed window must reject, never throw out of a grant made inside `off`.
    resolveTask: async (worktreeId) => resolveAgentTaskInRenderer(requireWindow(), worktreeId),
    lightTask: async (worktreeId, repoIds) =>
      lightAgentTaskInRenderer(requireWindow(), worktreeId, repoIds),
    readServer: async (repoId) => {
      const terminal = getSpotlightTerminal(repoId)
      return terminal ? readSpotlightServerState(terminal.ptyId) : 'unknown'
    },
    getCap: () =>
      normalizeSpotlightMaxConcurrentTests(store.getSettings().spotlightMaxConcurrentTests),
    getLane: (worktreeId) => {
      const repo = store.getRepo(getRepoIdFromWorktreeId(worktreeId))
      return laneKeyOf(worktreeId, {
        projectGroups: store.getProjectGroups(),
        repos: repo ? [repo] : [],
        folderWorkspaces: store.getFolderWorkspaces()
      })
    },
    readTurnEnd: (paneKey) =>
      readTurnEndFromRows(agentHookServer.getStatusSnapshotForPane(paneKey)),
    paneAccountAtLimit: (paneKey) =>
      isPaneAccountAtLimit({
        transcriptPath: paneTranscriptPath(agentHookServer.getStatusSnapshotForPane(paneKey)),
        saved: store.getSettings().claudeManagedAccounts,
        accounts: args.accounts,
        platform: process.platform
      }),
    // Why: a pty's teardown drops its key, and a restarted pane's new pty registers it again.
    isPaneLive: (paneKey) => getPtyIdForPaneKey(paneKey) !== undefined,
    notify: (board) => {
      // Why the getter: it is null once the window is destroyed.
      args.getWindow()?.webContents.send('spotlight:turnsChanged', board)
    }
  })
  agentHookServer.subscribeStatusChanges((statuses) => void turns.handleAgentStatuses(statuses))
  agentHookServer.subscribeStatusFreshness((status) =>
    turns.noteAgentActivity(status.paneKey, status.receivedAt)
  )
  registerPaneKeyTeardownListener((paneKey) => turns.handlePaneGone(paneKey))
  // Why: a waiter blocked inside `orca spotlight on` must get in when the limit goes up, not on
  // the next queue event, and the footer must show the new limit.
  store.onSettingsChanged((updates) => {
    if ('spotlightMaxConcurrentTests' in updates) {
      turns.capChanged()
    }
  })
  setSpotlightAgentTurns(turns)
}
