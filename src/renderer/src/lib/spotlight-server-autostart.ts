// Turning a Spotlight on starts the repo's dev server in its Spotlight terminal, in the background,
// with the command for the activated worktree's task environment.
import { useAppStore } from '@/store'
import type { SpotlightServerStartResult } from '../../../shared/spotlight'
import { resolveSpotlightServerCommand } from '../../../shared/spotlight-server-command'
import type { SpotlightServerCommands } from '../../../shared/spotlight-server-types'
import type { Worktree } from '../../../shared/worktree/types'
import { getSpotlightEnvForTask } from '@/store/slices/ui/ui-slice-spotlight-env-actions'
import { buildWorktreeTaskKeys } from '@/components/sidebar/worktree-list/grouping/worktree-task-keys'
import { requestBackgroundTerminalWorktreeMount } from '@/components/terminal/background-terminal-worktree-mount'
import {
  openSpotlightTerminalTab,
  planSpotlightTerminal,
  type OpenSpotlightTerminalTabResult
} from '@/lib/open-spotlight-terminal-tab'
import { getSpotlightEnvKey, toSpotlightEnvKey } from '@/lib/spotlight-env-key'
import { watchSpotlightStartupClaim } from '@/lib/spotlight-startup-claim-watch'

/** What happened to the server after the activation; `command` is the one Orca runs. */
export type SpotlightServerAutostart =
  | { kind: 'none' }
  | { kind: 'queued' | 'started' | 'restarted'; command: string }

export type SpotlightActivationTerminal = {
  opened: OpenSpotlightTerminalTabResult
  server: SpotlightServerAutostart
}

const NO_SERVER: SpotlightServerAutostart = { kind: 'none' }

// `no-terminal` right after a spawn means main is still registering the new PTY's log capture.
const START_ATTEMPTS = 5
export const SPOTLIGHT_START_RETRY_DELAY_MS = 400

async function detectServerCommands(repoId: string): Promise<SpotlightServerCommands | undefined> {
  try {
    return (await window.api.repos.detectSpotlightServerScripts({ repoId })).detected
  } catch (error) {
    console.warn('[spotlight] Server script detection failed:', error)
    return undefined
  }
}

// Why every repo: a branch-name task is only a task when it spans 2+ repos, like in the sidebar.
function listAllWorktrees(): Worktree[] {
  return Object.values(useAppStore.getState().worktreesByRepo)
    .flat()
    .filter((entry) => !entry.isArchived)
}

/** The activated worktree's server command: repo config, else detected scripts, in the environment
 *  of its task (or of the workspace itself when it has none). Null when the repo isn't started
 *  there (e.g. the backend in Dev). */
export async function resolveSpotlightActivationCommand(
  repoId: string,
  worktreeId: string
): Promise<string | null> {
  const state = useAppStore.getState()
  const repo = state.repos.find((entry) => entry.id === repoId)
  if (!repo) {
    return null
  }
  const worktree = state.worktreesByRepo[repoId]?.find((entry) => entry.id === worktreeId)
  const envKey = worktree ? getSpotlightEnvKey(worktree, listAllWorktrees()) : null
  const env = getSpotlightEnvForTask(state.spotlightEnvByTaskKey, envKey)
  const detected = await detectServerCommands(repoId)
  return resolveSpotlightServerCommand({ config: repo.spotlightServer, detected, env })
}

async function prepareLaunch(repoId: string, command: string): Promise<string | null> {
  try {
    return await window.api.spotlight.prepareServerLaunch({ repoId, command })
  } catch (error) {
    console.warn('[spotlight] Could not prepare the server launch:', error)
    return null
  }
}

/** Main takes back a prepared line that will never run. Never rejects. */
async function cancelPreparedLaunch(repoId: string): Promise<void> {
  try {
    await window.api.spotlight.cancelPreparedServerLaunch({ repoId })
  } catch (error) {
    console.warn('[spotlight] Could not cancel the prepared server launch:', error)
  }
}

function waitForRetry(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, SPOTLIGHT_START_RETRY_DELAY_MS))
}

/** Main types it only into an idle shell (with any pending install first), or replaces Orca's own
 *  server when the command differs; a server started by hand is left alone. */
async function startServerInTerminal(
  repoId: string,
  command: string
): Promise<SpotlightServerStartResult | null> {
  try {
    for (let attempt = 1; ; attempt += 1) {
      const result = await window.api.spotlight.startServer({
        repoId,
        command,
        restartIfDifferent: true
      })
      if (result.ok || result.reason !== 'no-terminal' || attempt >= START_ATTEMPTS) {
        return result
      }
      await waitForRetry()
    }
  } catch (error) {
    console.warn('[spotlight] Could not start the server:', error)
    return null
  }
}

function describeStart(
  result: SpotlightServerStartResult | null,
  command: string
): SpotlightServerAutostart {
  if (!result?.ok || !result.started) {
    return NO_SERVER
  }
  return { kind: result.restarted ? 'restarted' : 'started', command }
}

function spawnInBackground(
  repoId: string,
  command: string,
  worktreeId: string,
  tabId: string
): void {
  try {
    // Why: a reveal:false tab otherwise never spawns until the user opens the main workspace.
    requestBackgroundTerminalWorktreeMount({ worktreeId, tabIds: [tabId] })
    watchSpotlightStartupClaim({
      repoId,
      worktreeId,
      tabId,
      onDropped: () => void cancelPreparedLaunch(repoId),
      // Cancel first, so the live start chains the install the queued line had taken.
      onUnclaimed: () =>
        void cancelPreparedLaunch(repoId).then(() => startServerInTerminal(repoId, command))
    })
  } catch (error) {
    console.warn('[spotlight] Could not spawn the Spotlight terminal in the background:', error)
  }
}

/**
 * Opens the repo's Spotlight terminal after a successful activation and starts its server there.
 * A terminal that must spawn gets the command queued before its pane can mount; a live one gets
 * it typed by main. Never throws for the server part: a failure leaves just the terminal.
 */
export async function openSpotlightTerminalAndStartServer(args: {
  repoId: string
  worktreeId: string
}): Promise<SpotlightActivationTerminal> {
  const { repoId, worktreeId } = args
  let command: string | null = null
  try {
    command = await resolveSpotlightActivationCommand(repoId, worktreeId)
  } catch (error) {
    console.warn('[spotlight] Could not resolve the server command:', error)
  }
  if (!command) {
    return { opened: openSpotlightTerminalTab({ repoId, reveal: false }), server: NO_SERVER }
  }

  const plan = planSpotlightTerminal(useAppStore.getState(), repoId)
  // Why before opening: the async prepare must finish so the tab is created and queued in one tick.
  const launch =
    plan.kind !== 'no-main-worktree' && plan.ptyId === null
      ? await prepareLaunch(repoId, command)
      : null
  const opened = openSpotlightTerminalTab({
    repoId,
    reveal: false,
    ...(launch ? { startupCommand: launch } : {})
  })
  if (launch && !(opened.ok && opened.startupQueued)) {
    // The PTY bound while preparing, so the line was never queued; cancel before the live start.
    await cancelPreparedLaunch(repoId)
  }
  if (!opened.ok) {
    return { opened, server: NO_SERVER }
  }
  if (opened.startupQueued) {
    spawnInBackground(repoId, command, opened.worktreeId, opened.tabId)
    return { opened, server: { kind: 'queued', command } }
  }
  if (opened.ptyId === null) {
    // Prepare was refused (Spotlight went off meanwhile); the tab spawns idle when visited.
    return { opened, server: NO_SERVER }
  }
  // Live PTY (or one that bound while preparing): main can type only once it mirrors it.
  await opened.logPtyRegistered
  return { opened, server: describeStart(await startServerInTerminal(repoId, command), command) }
}

/**
 * After an environment switch: for every repo whose Spotlight is held by a workspace with this env
 * key, starts the command of the new environment (main replaces only a server Orca launched).
 * A repo with no command there is left running. Never throws.
 */
export async function applySpotlightEnvChange(envKey: string): Promise<void> {
  try {
    const state = useAppStore.getState()
    const taskKeys = buildWorktreeTaskKeys(listAllWorktrees())
    const holders: { repoId: string; worktreeId: string }[] = []
    for (const [repoId, spotlight] of Object.entries(state.spotlightByRepo)) {
      const holder = state.worktreesByRepo[repoId]?.find(
        (entry) => entry.id === spotlight.holderWorktreeId
      )
      if (holder && toSpotlightEnvKey(taskKeys.getTaskKey(holder), holder.id) === envKey) {
        holders.push({ repoId, worktreeId: holder.id })
      }
    }
    await Promise.all(
      holders.map(async ({ repoId, worktreeId }) => {
        const command = await resolveSpotlightActivationCommand(repoId, worktreeId)
        if (command) {
          await startServerInTerminal(repoId, command)
        }
      })
    )
  } catch (error) {
    console.warn('[spotlight] Could not apply the environment change:', error)
  }
}
