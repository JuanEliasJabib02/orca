import path from 'node:path'
import type { Repo } from '../../shared/repo-types'
import type { SpotlightRepoState, SpotlightServerState } from '../../shared/spotlight'
import type {
  SpotlightAgentLightResult,
  SpotlightAgentOffResult,
  SpotlightAgentOnResult,
  SpotlightAgentServer,
  SpotlightAgentStatus,
  SpotlightAgentTaskMember,
  SpotlightAgentTaskResolution
} from '../../shared/spotlight-agent-turn'
import type { WorkspacePortScanResult } from '../../shared/workspace-ports'
import { describeTurnServers } from './spotlight-agent-servers'
import { SpotlightTurnQueue, type SpotlightTurn } from './spotlight-agent-turn-queue'

export const DEFAULT_SPOTLIGHT_ON_TIMEOUT_MS = 100_000
const MAX_SPOTLIGHT_ON_TIMEOUT_MS = 10 * 60_000
const PORT_POLL_MS = 2_500
// Why: a lit project whose terminal runs nothing this long after lighting has no server to wait for.
const NO_SERVER_GRACE_MS = 15_000

export type SpotlightAgentTurnsDeps = {
  getRepo: (repoId: string) => Repo | undefined
  getSpotlightState: (repoId: string) => SpotlightRepoState | null
  listSpotlightStates: () => SpotlightRepoState[]
  resolveTask: (worktreeId: string) => Promise<SpotlightAgentTaskResolution>
  lightTask: (worktreeId: string, repoIds: string[]) => Promise<SpotlightAgentLightResult[]>
  readServer: (repoId: string) => Promise<SpotlightServerState>
  now?: () => number
}

/** Agent statuses as the hook server publishes them. */
export type SpotlightAgentStatusEntry = {
  paneKey: string
  state: string
  receivedAt: number
  observedInCurrentRuntime: boolean
}

type LightResults = Map<string, SpotlightAgentLightResult>

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const done = (): void => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', done)
      resolve()
    }
    const timer = setTimeout(done, Math.max(0, ms))
    signal?.addEventListener('abort', done, { once: true })
  })
}

/**
 * Agents' turns at the Spotlight (`orca spotlight on|off|status`). The queue decides who may light
 * which projects; the renderer lights them like the task-header button. A grant lights right away,
 * even when no `on` call is waiting, so the next task's servers warm up as soon as it's its turn.
 */
export class SpotlightAgentTurns {
  private readonly queue: SpotlightTurnQueue
  private readonly now: () => number
  /** Panes holding or waiting for a turn: the worktree they asked from and when they last asked. */
  private readonly panes = new Map<string, { worktreeId: string; requestedAt: number }>()
  private readonly lighting = new Map<string, Promise<LightResults>>()
  private readonly wakeups = new Map<string, Set<() => void>>()

  constructor(private readonly deps: SpotlightAgentTurnsDeps) {
    this.now = deps.now ?? Date.now
    this.queue = new SpotlightTurnQueue(this.now)
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
    if (task.members.length === 0) {
      const off =
        task.skippedRepoNames.length > 0
          ? ` Spotlight is off for: ${task.skippedRepoNames.join(', ')}.`
          : ''
      throw new Error(`No project of ${task.taskKey} can hold a Spotlight on this machine.${off}`)
    }
    this.panes.set(paneKey, { worktreeId, requestedAt: this.now() })
    const outcome = this.queue.request({
      paneKey,
      taskKey: task.taskKey,
      repoIds: task.members.map((member) => member.repoId)
    })
    this.onGranted(outcome.granted)
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
        blockers: position.blockers.map((blocker) => ({
          taskKey: blocker.taskKey,
          repoNames: this.repoNames(blocker.repoIds),
          holding: blocker.holding
        }))
      }
    }
    const { turn } = position
    const lightResults = await this.light(turn.taskKey, worktreeId, turn.repoIds)
    const { servers, ready } = await this.waitForServers({
      repoIds: turn.repoIds,
      members: task.members,
      lightResults,
      deadline,
      signal,
      scanPorts: args.scanPorts
    })
    return {
      status: 'on',
      taskKey: task.taskKey,
      servers,
      skippedRepoNames: [...task.skippedRepoNames, ...this.repoNames(outcome.skippedRepoIds)],
      ready
    }
  }

  /** Gives the pane's turn (or place in line) back; the Spotlight stays as it is. */
  off(paneKey: string): SpotlightAgentOffResult {
    this.panes.delete(paneKey)
    const outcome = this.queue.release(paneKey)
    this.onGranted(outcome.granted)
    this.wake(paneKey)
    return {
      releasedTaskKey: outcome.releasedTaskKey,
      wasWaiting: outcome.wasWaiting,
      nextTaskKeys: outcome.granted.map((turn) => turn.taskKey)
    }
  }

  status(): SpotlightAgentStatus {
    const snapshot = this.queue.snapshot()
    const waitingTasks = new Set<string>()
    return {
      turns: snapshot.turns.map((turn) => ({
        taskKey: turn.taskKey,
        repoNames: this.repoNames(turn.repoIds),
        panes: turn.paneKeys.length,
        grantedAt: turn.grantedAt
      })),
      waiting: snapshot.waiting.flatMap((waiter) => {
        if (waitingTasks.has(waiter.taskKey)) {
          return []
        }
        waitingTasks.add(waiter.taskKey)
        return [
          {
            taskKey: waiter.taskKey,
            repoNames: this.repoNames(waiter.repoIds),
            since: waiter.since
          }
        ]
      }),
      lit: this.deps.listSpotlightStates().map((state) => ({
        repoName: this.repoNames([state.repoId])[0],
        holder: worktreeFolderName(state.holderWorktreeId),
        turnTaskKey:
          snapshot.turns.find((turn) => turn.repoIds.includes(state.repoId))?.taskKey ?? null
      }))
    }
  }

  /** A turn ends when its agent finishes: `done` newer than the pane's last request. */
  handleAgentStatuses(entries: readonly SpotlightAgentStatusEntry[]): void {
    for (const entry of entries) {
      const pane = this.panes.get(entry.paneKey)
      if (
        pane &&
        entry.state === 'done' &&
        entry.observedInCurrentRuntime &&
        entry.receivedAt > pane.requestedAt
      ) {
        this.off(entry.paneKey)
      }
    }
  }

  handlePaneGone(paneKey: string): void {
    if (this.panes.has(paneKey) || this.queue.positionOf(paneKey)) {
      this.off(paneKey)
    }
  }

  private onGranted(turns: readonly SpotlightTurn[]): void {
    for (const turn of turns) {
      const worktreeId = turn.paneKeys
        .map((paneKey) => this.panes.get(paneKey)?.worktreeId)
        .find((id) => id !== undefined)
      if (worktreeId !== undefined) {
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

  /** Polls until every lit project listens, or has no server, or the call runs out of time. */
  private async waitForServers(args: {
    repoIds: string[]
    members: readonly SpotlightAgentTaskMember[]
    lightResults: LightResults
    deadline: number
    signal?: AbortSignal
    scanPorts: () => Promise<WorkspacePortScanResult | null>
  }): Promise<{ servers: SpotlightAgentServer[]; ready: boolean }> {
    const litAt = this.now()
    const probe = { ...this.deps, scanPorts: args.scanPorts }
    for (;;) {
      const servers = await describeTurnServers({
        repoIds: args.repoIds,
        members: args.members,
        lightResults: args.lightResults,
        probe
      })
      const lit = servers.filter((server) => server.lit)
      const ready = lit.length > 0 && lit.every((server) => server.listening)
      const settled = lit.every(
        (server) =>
          server.listening ||
          (server.server !== 'running' && this.now() - litAt >= NO_SERVER_GRACE_MS)
      )
      if (ready || settled || this.now() >= args.deadline || args.signal?.aborted) {
        return { servers, ready }
      }
      await sleep(Math.min(PORT_POLL_MS, args.deadline - this.now()), args.signal)
    }
  }

  private repoNames(repoIds: readonly string[]): string[] {
    return repoIds.map((repoId) => this.deps.getRepo(repoId)?.displayName ?? repoId)
  }
}

/** `repoId::/path/to/worktree` → `worktree`. */
function worktreeFolderName(worktreeId: string): string {
  const separator = worktreeId.indexOf('::')
  return path.basename(separator === -1 ? worktreeId : worktreeId.slice(separator + 2))
}

let instance: SpotlightAgentTurns | null = null

export function setSpotlightAgentTurns(turns: SpotlightAgentTurns | null): void {
  instance = turns
}

/** Null until the main window attached Spotlight (never under headless serve). */
export function getSpotlightAgentTurns(): SpotlightAgentTurns | null {
  return instance
}
