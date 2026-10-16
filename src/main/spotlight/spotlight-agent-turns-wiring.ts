import type { BrowserWindow } from 'electron'
import { agentHookServer } from '../agent-hooks/server'
import { registerPaneKeyTeardownListener } from '../ipc/pty/pane/key-state'
import type { Store } from '../persistence'
import {
  lightAgentTaskInRenderer,
  resolveAgentTaskInRenderer
} from './spotlight-agent-task-request'
import {
  getSpotlightAgentTurns,
  setSpotlightAgentTurns,
  SpotlightAgentTurns
} from './spotlight-agent-turns'
import { getSpotlightTerminal } from './spotlight-log-mirror'
import type { SpotlightService } from './spotlight-service'
import { readSpotlightServerState } from './spotlight-terminal-inspection'

/** Once per process, like the Spotlight service: turns must outlive a macOS window re-attach. */
export function installSpotlightAgentTurns(args: {
  store: Store
  service: SpotlightService
  getWindow: () => BrowserWindow | null
}): void {
  if (getSpotlightAgentTurns()) {
    return
  }
  const requireWindow = (): BrowserWindow => {
    const win = args.getWindow()
    if (!win) {
      throw new Error('The Orca window is not open, so no Spotlight can be lit.')
    }
    return win
  }
  const turns = new SpotlightAgentTurns({
    getRepo: (repoId) => args.store.getRepo(repoId),
    getSpotlightState: (repoId) => args.service.getState(repoId),
    listSpotlightStates: () => Object.values(args.service.getStateSnapshot().byRepo),
    // Why async: a closed window must reject, never throw out of a grant made inside `off`.
    resolveTask: async (worktreeId) => resolveAgentTaskInRenderer(requireWindow(), worktreeId),
    lightTask: async (worktreeId, repoIds) =>
      lightAgentTaskInRenderer(requireWindow(), worktreeId, repoIds),
    readServer: async (repoId) => {
      const terminal = getSpotlightTerminal(repoId)
      return terminal ? readSpotlightServerState(terminal.ptyId) : 'unknown'
    }
  })
  agentHookServer.subscribeStatusChanges((statuses) => turns.handleAgentStatuses(statuses))
  registerPaneKeyTeardownListener((paneKey) => turns.handlePaneGone(paneKey))
  setSpotlightAgentTurns(turns)
}
