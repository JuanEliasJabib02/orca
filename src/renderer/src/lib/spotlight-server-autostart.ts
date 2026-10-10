// Turning a Spotlight on starts the repo's dev server in its Spotlight terminal, in the background,
// with the command for the activated worktree's task environment (and variant, when it has one).
import { useAppStore } from '@/store'
import type { SpotlightServerStartResult } from '../../../shared/spotlight'
import { isSafeSpotlightVariant } from '../../../shared/spotlight-server-variant'
import { buildWorktreeTaskKeys } from '@/components/sidebar/worktree-list/grouping/worktree-task-keys'
import {
  dismissSpotlightVariantPrompt,
  showSpotlightVariantPrompt
} from '@/components/sidebar/spotlight-variant-prompt-toast'
import { requestBackgroundTerminalWorktreeMount } from '@/components/terminal/background-terminal-worktree-mount'
import {
  openSpotlightTerminalTab,
  planSpotlightTerminal,
  type OpenSpotlightTerminalTabResult
} from '@/lib/open-spotlight-terminal-tab'
import { getSpotlightEnvKey, toSpotlightEnvKey } from '@/lib/spotlight-env-key'
import {
  listAllWorktrees,
  planSpotlightActivationCommand,
  type SpotlightActivationCommandPlan
} from '@/lib/spotlight-server-command-plan'
import { watchSpotlightStartupClaim } from '@/lib/spotlight-startup-claim-watch'
import {
  logFailedSpotlightStart,
  logSpotlightActivationWithoutCommand,
  logSpotlightAutostart
} from '@/lib/spotlight-autostart-log'

export { resolveSpotlightActivationCommand } from '@/lib/spotlight-server-command-plan'

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

/** The line to queue; `refused` when main declined (Spotlight no longer active, invalid command). */
type PreparedLaunch = { line: string } | { line: null; refused: boolean }

async function prepareLaunch(repoId: string, command: string): Promise<PreparedLaunch> {
  try {
    const line = await window.api.spotlight.prepareServerLaunch({ repoId, command })
    return line === null ? { line, refused: true } : { line }
  } catch (error) {
    console.warn('[spotlight] Could not prepare the server launch:', error)
    return { line: null, refused: false }
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
 *  server when the command differs; a server started by hand is left alone. Every outcome lands in
 *  the repo's Spotlight log: main notes the ones it decides, this the failures. */
async function startServerInTerminal(
  repoId: string,
  command: string
): Promise<SpotlightServerStartResult | null> {
  const result = await requestStart(repoId, command)
  logFailedSpotlightStart(repoId, result)
  return result
}

async function requestStart(
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
      // Noted before the cancel: main quotes the line it still holds.
      onDropped: (reason) => {
        logSpotlightAutostart(repoId, { kind: 'queued-dropped', reason })
        void cancelPreparedLaunch(repoId)
      },
      // Cancel first, so the live start chains the install the queued line had taken.
      onUnclaimed: () =>
        void cancelPreparedLaunch(repoId).then(() => startServerInTerminal(repoId, command)),
      onClaimed: () => logSpotlightAutostart(repoId, { kind: 'queued-started' })
    })
  } catch (error) {
    console.warn('[spotlight] Could not spawn the Spotlight terminal in the background:', error)
  }
}

type OpenAndStartOutcome = {
  activation: SpotlightActivationTerminal
  /** Main says the tab's PTY no longer exists, so nothing was typed. */
  deadPtyId: string | null
}

/** One pass: a terminal that must spawn gets the command queued before its pane can mount; a live
 *  one gets it typed by main. */
async function openAndStart(repoId: string, command: string): Promise<OpenAndStartOutcome> {
  const done = (
    opened: OpenSpotlightTerminalTabResult,
    server = NO_SERVER
  ): OpenAndStartOutcome => ({
    activation: { opened, server },
    deadPtyId: null
  })
  const plan = planSpotlightTerminal(useAppStore.getState(), repoId)
  // Why before opening: the async prepare must finish so the tab is created and queued in one tick.
  const prepared =
    plan.kind !== 'no-main-worktree' && plan.ptyId === null
      ? await prepareLaunch(repoId, command)
      : null
  const launch = prepared?.line ?? null
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
    logSpotlightAutostart(repoId, { kind: 'no-main-worktree' })
    return done(opened)
  }
  if (opened.startupQueued) {
    logSpotlightAutostart(repoId, { kind: 'queued' })
    spawnInBackground(repoId, command, opened.worktreeId, opened.tabId)
    return done(opened, { kind: 'queued', command })
  }
  if (opened.ptyId === null) {
    // Prepare was refused (Spotlight went off meanwhile); the tab spawns idle when visited.
    const refused = prepared?.line === null && prepared.refused
    logSpotlightAutostart(repoId, { kind: 'prepare-failed', refused })
    return done(opened)
  }
  // Live PTY (or one that bound while preparing): main can type only once it mirrors it.
  await opened.logPtyRegistered
  const result = await startServerInTerminal(repoId, command)
  if (result?.ok === false && result.reason === 'terminal-gone') {
    return { activation: { opened, server: NO_SERVER }, deadPtyId: opened.ptyId }
  }
  return done(opened, describeStart(result, command))
}

/** Forget a PTY main proved gone, exactly as its exit would, so the tab spawns a new one. */
function forgetDeadPty(tabId: string, ptyId: string): boolean {
  try {
    useAppStore.getState().clearTabPtyId(tabId, ptyId)
    return true
  } catch (error) {
    console.warn('[spotlight] Could not forget the dead Spotlight terminal PTY:', error)
    return false
  }
}

/** Prompts for the variant; picking one starts the server. Never throws. */
function askForVariant(repoId: string, worktreeId: string, candidates: readonly string[]): void {
  try {
    const repo = useAppStore.getState().repos.find((entry) => entry.id === repoId)
    showSpotlightVariantPrompt({
      repoId,
      projectName: repo?.displayName ?? repoId,
      candidates,
      onPick: (variant) => void chooseSpotlightVariant({ repoId, worktreeId, variant })
    })
  } catch (error) {
    console.warn('[spotlight] Could not ask for the server variant:', error)
  }
}

/**
 * Opens the repo's Spotlight terminal after a successful activation and starts its server there.
 * A tab restored with a PTY that no longer exists is respawned with the command queued, like a new
 * one. A command that needs a variant nobody chose asks for it and starts nothing yet. Never throws
 * for the server part: a failure leaves just the terminal.
 */
export async function openSpotlightTerminalAndStartServer(args: {
  repoId: string
  worktreeId: string
  /** A variant the user just picked; otherwise the task's remembered or inferred one. */
  variant?: string
}): Promise<SpotlightActivationTerminal> {
  const { repoId, worktreeId } = args
  let plan: SpotlightActivationCommandPlan | null = null
  try {
    plan = await planSpotlightActivationCommand(repoId, worktreeId, args.variant)
  } catch (error) {
    console.warn('[spotlight] Could not resolve the server command:', error)
  }
  if (plan === null || plan.kind !== 'command') {
    const opened = openSpotlightTerminalTab({ repoId, reveal: false })
    logSpotlightActivationWithoutCommand(repoId, plan)
    if (plan?.kind === 'ask-variant') {
      askForVariant(repoId, worktreeId, plan.candidates)
    }
    return { opened, server: NO_SERVER }
  }
  const { command } = plan
  const first = await openAndStart(repoId, command)
  const { opened } = first.activation
  if (first.deadPtyId === null || !opened.ok || !forgetDeadPty(opened.tabId, first.deadPtyId)) {
    return first.activation
  }
  // Once only: a PTY the store won't let go of answers gone again and is left as it is.
  return (await openAndStart(repoId, command)).activation
}

/**
 * The user picked the variant a repo's Spotlight server runs for the worktree's task: remembers it,
 * then starts the server, or replaces the one Orca runs, while that worktree still holds the
 * Spotlight. Never throws.
 */
export async function chooseSpotlightVariant(args: {
  repoId: string
  worktreeId: string
  variant: string
}): Promise<void> {
  const { repoId, worktreeId, variant } = args
  if (!isSafeSpotlightVariant(variant)) {
    return
  }
  try {
    dismissSpotlightVariantPrompt(repoId)
    const state = useAppStore.getState()
    const worktree = state.worktreesByRepo[repoId]?.find((entry) => entry.id === worktreeId)
    const envKey = worktree ? getSpotlightEnvKey(worktree, listAllWorktrees()) : null
    if (envKey !== null) {
      state.setSpotlightVariantForTaskRepo(envKey, repoId, variant)
    }
    // Why: a prompt answered after a turn-off or takeover must not start a server for the old holder.
    if (useAppStore.getState().spotlightByRepo[repoId]?.holderWorktreeId !== worktreeId) {
      return
    }
    await openSpotlightTerminalAndStartServer({ repoId, worktreeId, variant })
  } catch (error) {
    console.warn('[spotlight] Could not apply the chosen server variant:', error)
  }
}

/**
 * After an environment switch: for every repo whose Spotlight is held by a workspace with this env
 * key, in any space, starts the command of the new environment (main replaces only a server Orca
 * launched).
 * A repo with no command there is left running; one whose command needs an unknown variant asks
 * for it first. Never throws.
 */
export async function applySpotlightEnvChange(envKey: string): Promise<void> {
  try {
    const state = useAppStore.getState()
    const taskKeys = buildWorktreeTaskKeys(listAllWorktrees())
    // Why no space limit: the env setting is stored per task key, so a same-named task in another space shares it.
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
        const plan = await planSpotlightActivationCommand(repoId, worktreeId)
        if (plan.kind === 'command') {
          await startServerInTerminal(repoId, plan.command)
        } else if (plan.kind === 'ask-variant') {
          askForVariant(repoId, worktreeId, plan.candidates)
        }
      })
    )
  } catch (error) {
    console.warn('[spotlight] Could not apply the environment change:', error)
  }
}
