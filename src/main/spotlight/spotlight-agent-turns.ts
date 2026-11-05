import { errorMessage } from '../../shared/error-message'
import type { Repo } from '../../shared/repo-types'
import type { SpotlightRepoState, SpotlightServerState } from '../../shared/spotlight'
import type {
  SpotlightAgentLightResult,
  SpotlightAgentOffResult,
  SpotlightAgentOnResult,
  SpotlightAgentStatus,
  SpotlightAgentTaskResolution
} from '../../shared/spotlight-agent-turn'
import type { WorkspacePortScanResult } from '../../shared/workspace-ports'
import { waitForTurnServers } from './spotlight-agent-servers'
import {
  SpotlightTurnPauses,
  type SpotlightAgentStatusEntry,
  type SpotlightTurnEnd
} from './spotlight-agent-turn-pause'
import { SpotlightTurnQueue, type SpotlightTurn } from './spotlight-agent-turn-queue'
import {
  buildSpotlightBoard,
  describeMine,
  toAgentBlockers,
  type SpotlightBoardSources
} from './spotlight-agent-turns-status'

export const DEFAULT_SPOTLIGHT_ON_TIMEOUT_MS = 100_000
const MAX_SPOTLIGHT_ON_TIMEOUT_MS = 10 * 60_000

export type SpotlightAgentTurnsDeps = {
  getRepo: (repoId: string) => Repo | undefined
  getSpotlightState: (repoId: string) => SpotlightRepoState | null
  listSpotlightStates: () => SpotlightRepoState[]
  resolveTask: (worktreeId: string) => Promise<SpotlightAgentTaskResolution>
  lightTask: (worktreeId: string, repoIds: string[]) => Promise<SpotlightAgentLightResult[]>
  readServer: (repoId: string) => Promise<SpotlightServerState>
  now?: () => number
  /** Most tasks testing at once, read on every grant; none = no limit. */
  getCap?: () => number
  /** The space a worktree's turn belongs to: one task tests per lane. None = no lane limit. */
  getLane?: (worktreeId: string) => string | undefined
  /** How the pane's agent last ended a turn, from its hook rows; none = always a normal end. */
  readTurnEnd?: (paneKey: string) => SpotlightTurnEnd
  /** Whether the pane's Claude account is out of usage, after a forced usage read. */
  paneAccountAtLimit?: (paneKey: string) => Promise<boolean>
  /** Receives the board after every queue change. */
  notify?: (board: SpotlightAgentStatus) => void
}

type LightResults = Map<string, SpotlightAgentLightResult>

function slotOnlyNote(taskKey: string): string {
  return `No project of ${taskKey} can hold a Spotlight here, so this turn only holds a test slot: start what you test yourself, then run your tests.`
}

/**
 * Agents' turns at the Spotlight (`orca spotlight on|off|status`). The queue decides who may light
 * which projects; the renderer lights them like the task-header button. A grant lights right away,
 * even when no `on` call is waiting, so the next task's servers warm up as soon as it's its turn.
 */
export class SpotlightAgentTurns {
  private readonly queue: SpotlightTurnQueue
  private readonly now: () => number
  /** Panes holding, waiting for or paused in a turn: the worktree they asked from and when. */
  private readonly panes = new Map<string, { worktreeId: string; requestedAt: number }>()
  /** The newest hook activity of each pane above, for `status` only. */
  private readonly activity = new Map<string, number>()
  private readonly pauses: SpotlightTurnPauses
  private readonly lighting = new Map<string, Promise<LightResults>>()
  private readonly wakeups = new Map<string, Set<() => void>>()

  constructor(private readonly deps: SpotlightAgentTurnsDeps) {
    this.now = deps.now ?? Date.now
    this.queue = new SpotlightTurnQueue({ now: this.now, cap: () => this.cap() })
    this.pauses = new SpotlightTurnPauses({
      queue: this.queue,
      now: this.now,
      requestedAt: (paneKey) => this.panes.get(paneKey)?.requestedAt,
      release: (paneKey) => this.off(paneKey),
      granted: (turns) => this.onGranted(turns),
      publish: () => this.publish(),
      readTurnEnd: deps.readTurnEnd,
      paneAccountAtLimit: deps.paneAccountAtLimit
    })
  }

  async on(args: {
    paneKey: string
    worktreeId: string
    timeoutMs?: number
    signal?: AbortSignal
    scanPorts: () => Promise<WorkspacePortScanResult | null>
  }): Promise<SpotlightAgentOnResult> {
    const { paneKey, worktreeId, signal } = args
    const timeoutMs = Math.min(
      args.timeoutMs || DEFAULT_SPOTLIGHT_ON_TIMEOUT_MS,
      MAX_SPOTLIGHT_ON_TIMEOUT_MS
    )
    const deadline = this.now() + timeoutMs
    const task = await this.deps.resolveTask(worktreeId)
    this.panes.set(paneKey, { worktreeId, requestedAt: this.now() })
    // Why: asking for the turn is what a resumed agent does; Continuar's window has done its job.
    this.pauses.closeWindow(paneKey)
    const outcome = this.queue.request({
      paneKey,
      taskKey: task.taskKey,
      // Why none is fine: a task with no Spotlight project still takes a test slot.
      repoIds: task.members.map((member) => member.repoId),
      laneKey: this.deps.getLane?.(worktreeId)
    })
    this.onGranted(outcome.granted)
    this.publish()
    let position = outcome.position
    if (position.kind === 'waiting') {
      await this.waitForTurn(paneKey, deadline, signal)
      position = this.queue.positionOf(paneKey) ?? position
    }
    if (position.kind === 'waiting') {
      return {
        status: 'waiting',
        taskKey: task.taskKey,
        position: position.position,
        blockers: toAgentBlockers(position.blockers, (repoIds) => this.repoNames(repoIds))
      }
    }
    const { turn } = position
    const skippedRepoNames = [...task.skippedRepoNames, ...this.repoNames(outcome.skippedRepoIds)]
    if (turn.repoIds.length === 0) {
      return {
        status: 'on',
        taskKey: task.taskKey,
        servers: [],
        skippedRepoNames,
        ready: true,
        note: slotOnlyNote(task.taskKey)
      }
    }
    const lightResults = await this.light(turn.taskKey, worktreeId, turn.repoIds)
    const { servers, ready } = await waitForTurnServers({
      repoIds: turn.repoIds,
      members: task.members,
      lightResults,
      deadline,
      now: this.now,
      signal,
      probe: { ...this.deps, scanPorts: args.scanPorts }
    })
    return { status: 'on', taskKey: task.taskKey, servers, skippedRepoNames, ready }
  }

  /** The limit changed in Settings: a raise lets waiters in now; a cut never evicts a holder. */
  capChanged(): void {
    this.onGranted(this.queue.regrant())
    this.publish()
  }

  /** Gives the pane's turn (or place in line) back; the Spotlight stays as it is. */
  off(paneKey: string): SpotlightAgentOffResult {
    this.panes.delete(paneKey)
    this.activity.delete(paneKey)
    this.pauses.forget(paneKey)
    const outcome = this.queue.release(paneKey)
    this.onGranted(outcome.granted)
    this.wake(paneKey)
    this.publish()
    return {
      releasedTaskKey: outcome.releasedTaskKey,
      wasWaiting: outcome.wasWaiting,
      nextTaskKeys: outcome.granted.map((turn) => turn.taskKey)
    }
  }

  /** The board; with `paneKey`, also where that pane stands (`mine`). */
  status(args: { paneKey?: string } = {}): SpotlightAgentStatus {
    const sources = this.boardSources()
    const board = buildSpotlightBoard(sources)
    if (args.paneKey === undefined) {
      return board
    }
    const position = this.queue.positionOf(args.paneKey)
    return { ...board, mine: describeMine(args.paneKey, position, sources) }
  }

  /** Hook statuses: activity for `status`, and turn ends that release or pause a pane. */
  handleAgentStatuses(entries: readonly SpotlightAgentStatusEntry[]): Promise<void> {
    for (const entry of entries) {
      this.noteAgentActivity(entry.paneKey, entry.receivedAt)
    }
    return this.pauses.handleStatuses(entries)
  }

  /** Hook activity that changes no status (tool and prompt pings), for `status`'s idle time. */
  noteAgentActivity(paneKey: string, at: number): void {
    if (this.panes.has(paneKey) && at > (this.activity.get(paneKey) ?? 0)) {
      this.activity.set(paneKey, at)
    }
  }

  handlePaneGone(paneKey: string): void {
    // Why: Continuar's restart stops the old process first; the pane comes back in its place.
    if (this.pauses.isResuming(paneKey)) {
      return
    }
    if (this.panes.has(paneKey) || this.queue.positionOf(paneKey)) {
      this.off(paneKey)
    }
  }

  /** Continuar starts on a paused pane or a holder; see `SpotlightTurnPauses.markResuming`. */
  markResuming(paneKey: string, options: { auto: boolean }): boolean {
    return this.pauses.markResuming(paneKey, options)
  }

  resumeSettled(paneKey: string, result: { delivered: boolean }): void {
    this.pauses.resumeSettled(paneKey, result)
  }

  private cap(): number {
    return this.deps.getCap?.() ?? Infinity
  }

  private boardSources(): SpotlightBoardSources {
    return {
      snapshot: this.queue.snapshot(),
      cap: this.cap(),
      lit: this.deps.listSpotlightStates(),
      repoNames: (repoIds) => this.repoNames(repoIds),
      requestedAt: (paneKey) => this.panes.get(paneKey)?.requestedAt,
      activityAt: (paneKey) => this.activity.get(paneKey),
      isResuming: (paneKey) => this.pauses.isResuming(paneKey),
      autoResumes: (paneKey) => this.pauses.autoResumes(paneKey)
    }
  }

  /** Never throws: a closed window must not break the queue change that pushes the board. */
  private publish(): void {
    if (!this.deps.notify) {
      return
    }
    try {
      this.deps.notify(this.status())
    } catch (error) {
      console.warn('[spotlight] Could not push the test queue:', errorMessage(error))
    }
  }

  private onGranted(turns: readonly SpotlightTurn[]): void {
    for (const turn of turns) {
      const worktreeId = turn.paneKeys
        .map((paneKey) => this.panes.get(paneKey)?.worktreeId)
        .find((id) => id !== undefined)
      // Why the projects: a slot-only turn has nothing to light.
      if (worktreeId !== undefined && turn.repoIds.length > 0) {
        void this.light(turn.taskKey, worktreeId, turn.repoIds)
      }
      turn.paneKeys.forEach((paneKey) => this.wake(paneKey))
    }
  }

  /** One light per task at a time; lighting an already-lit task changes nothing. */
  private light(taskKey: string, worktreeId: string, repoIds: string[]): Promise<LightResults> {
    const inflight = this.lighting.get(taskKey)
    if (inflight) {
      return inflight
    }
    const run = this.deps
      .lightTask(worktreeId, repoIds)
      .then((results): LightResults => new Map(results.map((result) => [result.repoId, result])))
      .catch(
        (error): LightResults =>
          new Map(
            repoIds.map((repoId) => [repoId, { repoId, ok: false, message: errorMessage(error) }])
          )
      )
      .finally(() => this.lighting.delete(taskKey))
    this.lighting.set(taskKey, run)
    return run
  }

  private waitForTurn(paneKey: string, deadline: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) {
      return Promise.resolve()
    }
    return new Promise((resolve) => {
      const wakeups = this.wakeups.get(paneKey) ?? new Set<() => void>()
      this.wakeups.set(paneKey, wakeups)
      const done = (): void => {
        clearTimeout(timer)
        signal?.removeEventListener('abort', done)
        wakeups.delete(done)
        if (wakeups.size === 0) {
          this.wakeups.delete(paneKey)
        }
        resolve()
      }
      const timer = setTimeout(done, Math.max(0, deadline - this.now()))
      signal?.addEventListener('abort', done, { once: true })
      wakeups.add(done)
    })
  }

  private wake(paneKey: string): void {
    // Why no copy: each `done` deletes only itself, which a Set iteration tolerates.
    for (const done of this.wakeups.get(paneKey) ?? []) {
      done()
    }
  }

  private repoNames(repoIds: readonly string[]): string[] {
    return repoIds.map((repoId) => this.deps.getRepo(repoId)?.displayName ?? repoId)
  }
}

let instance: SpotlightAgentTurns | null = null

export function setSpotlightAgentTurns(turns: SpotlightAgentTurns | null): void {
  instance = turns
}

/** Null until the main window attached Spotlight (never under headless serve). */
export function getSpotlightAgentTurns(): SpotlightAgentTurns | null {
  return instance
}
