import {
  pumpLine,
  snapshotTurn,
  waitingPlace,
  type LineEntry,
  type MutableTurn
} from './spotlight-agent-turn-queue-pump'

/** One agent pane asking for the Spotlight of every project its task needs. */
export type SpotlightTurnRequest = {
  paneKey: string
  taskKey: string
  repoIds: readonly string[]
  /** The space of the pane's project: one task holds a turn per lane. No lane, no lane limit. */
  laneKey?: string
}

/** A task holding the Spotlight of its projects; every pane of the task shares it. */
export type SpotlightTurn = {
  taskKey: string
  repoIds: string[]
  paneKeys: string[]
  grantedAt: number
  /** The lane of the pane that started the turn. */
  laneKey?: string
}

export type SpotlightTurnWaiter = {
  paneKey: string
  taskKey: string
  repoIds: string[]
  since: number
  laneKey?: string
}

/** Why a pane's agent stopped mid-turn: it ran out of usage limit, or failed otherwise. */
export type SpotlightTurnPauseReason = 'limit' | 'error'

export type SpotlightTurnPause = { reason: SpotlightTurnPauseReason; pausedAt: number }

/** A pane whose agent stopped mid-turn: it keeps its place and claims nothing until it asks. */
export type SpotlightTurnPausedWaiter = SpotlightTurnWaiter & SpotlightTurnPause

/**
 * Who stands between a waiter and its turn: a task holding or queued earlier for its projects (no
 * reason), for its lane (`lane`), or for a slot while every slot is taken (`cap`).
 */
export type SpotlightTurnBlocker = {
  taskKey: string
  repoIds: string[]
  holding: boolean
  reason?: 'lane' | 'cap'
}

export type SpotlightTurnPosition =
  | { kind: 'holding'; turn: SpotlightTurn }
  | {
      kind: 'waiting'
      position: number
      blockers: SpotlightTurnBlocker[]
      /** Set while the pane is paused: it keeps this place but claims nothing. */
      paused?: SpotlightTurnPause
    }

export type SpotlightTurnRequestOutcome = {
  position: SpotlightTurnPosition
  /** Projects of the task left out because another task holds them (only when joining a turn). */
  skippedRepoIds: string[]
  /** Turns created or extended by this call, for the caller to light. */
  granted: SpotlightTurn[]
}

export type SpotlightTurnReleaseOutcome = {
  releasedTaskKey: string | null
  wasWaiting: boolean
  /** Turns granted because this release freed their projects. */
  granted: SpotlightTurn[]
}

export type SpotlightTurnPauseOutcome = {
  /** The task the pane was paused in; null when it had no place or was already paused. */
  pausedTaskKey: string | null
  /** The pane left a turn it held. */
  wasHolding: boolean
  /** Turns granted because the pause freed their projects, lane or slot. */
  granted: SpotlightTurn[]
}

export type SpotlightTurnQueueSnapshot = {
  turns: SpotlightTurn[]
  waiting: SpotlightTurnWaiter[]
  paused: SpotlightTurnPausedWaiter[]
}

export type SpotlightTurnQueueOptions = {
  now?: () => number
  /** Most tasks holding a turn at once, read on every grant; none = no limit. */
  cap?: () => number
}

/**
 * Who may light which projects' Spotlight. A task gets all its projects or waits for them (so two
 * tasks never hold half of each other's), first come first served per project: a later request
 * never overtakes an earlier one wanting the same project, but requests with no project in common
 * never wait for each other. On top of that, one task per lane holds a turn and at most `cap` tasks
 * hold one at all.
 */
export class SpotlightTurnQueue {
  private readonly turns = new Map<string, MutableTurn>()
  /** The line in order; paused panes keep their place in it. */
  private waiting: LineEntry[] = []
  private readonly now: () => number
  private readonly cap: () => number

  constructor(options: (() => number) | SpotlightTurnQueueOptions = {}) {
    const resolved: SpotlightTurnQueueOptions =
      typeof options === 'function' ? { now: options } : options
    this.now = resolved.now ?? Date.now
    this.cap = resolved.cap ?? (() => Infinity)
  }

  request(request: SpotlightTurnRequest): SpotlightTurnRequestOutcome {
    const repoIds = [...new Set(request.repoIds)]
    // Why: a pane works for one task; asking for another gives up what it held for the old one.
    this.leaveTurns(request.paneKey, request.taskKey)
    const ownTurn = this.turns.get(request.taskKey)
    if (ownTurn) {
      return this.join(ownTurn, request.paneKey, repoIds)
    }
    const queued = this.waiting.find((waiter) => waiter.paneKey === request.paneKey)
    if (queued) {
      // Why in place: asking again keeps the place in line, and ends a pause.
      queued.taskKey = request.taskKey
      queued.repoIds = repoIds
      queued.laneKey = request.laneKey
      queued.pause = null
    } else {
      this.waiting.push({
        paneKey: request.paneKey,
        taskKey: request.taskKey,
        repoIds,
        laneKey: request.laneKey,
        since: this.now(),
        pause: null
      })
    }
    const granted = this.pump()
    const position: SpotlightTurnPosition = this.positionOf(request.paneKey) ?? {
      kind: 'waiting',
      position: 1,
      blockers: []
    }
    return { position, skippedRepoIds: [], granted }
  }

  /** Gives the pane's turn back, or its place in line (paused or not). */
  release(paneKey: string): SpotlightTurnReleaseOutcome {
    const before = this.waiting.length
    this.waiting = this.waiting.filter((waiter) => waiter.paneKey !== paneKey)
    const wasWaiting = this.waiting.length !== before
    const releasedTaskKey = this.leaveTurns(paneKey, null)
    return { releasedTaskKey, wasWaiting, granted: this.pump() }
  }

  /**
   * The pane's agent stopped mid-turn: takes it out of its turn but keeps its place, a holder at
   * the front of the line and a waiter where it stands. Its next `request` ends the pause.
   */
  pause(paneKey: string, info: { reason: SpotlightTurnPauseReason }): SpotlightTurnPauseOutcome {
    const queued = this.waiting.find((waiter) => waiter.paneKey === paneKey)
    if (queued) {
      if (queued.pause) {
        return { pausedTaskKey: null, wasHolding: false, granted: [] }
      }
      queued.pause = { reason: info.reason, pausedAt: this.now() }
      return { pausedTaskKey: queued.taskKey, wasHolding: false, granted: this.pump() }
    }
    const turn = [...this.turns.values()].find((candidate) => candidate.paneKeys.has(paneKey))
    if (!turn) {
      return { pausedTaskKey: null, wasHolding: false, granted: [] }
    }
    const pausedAt = this.now()
    this.leaveTurns(paneKey, null)
    // Why the front: it lost its turn mid-run, so it goes first once it asks again.
    this.waiting.unshift({
      paneKey,
      taskKey: turn.taskKey,
      repoIds: [...turn.repoIds],
      laneKey: turn.laneKey,
      since: pausedAt,
      pause: { reason: info.reason, pausedAt }
    })
    return { pausedTaskKey: turn.taskKey, wasHolding: true, granted: this.pump() }
  }

  /** Where the pane stands; a paused pane reports its place in line with `paused`. */
  positionOf(paneKey: string): SpotlightTurnPosition | null {
    for (const turn of this.turns.values()) {
      if (turn.paneKeys.has(paneKey)) {
        return { kind: 'holding', turn: snapshotTurn(turn) }
      }
    }
    const index = this.waiting.findIndex((waiter) => waiter.paneKey === paneKey)
    if (index === -1) {
      return null
    }
    const { position, blockers } = waitingPlace(this.turns, this.waiting, index, this.cap())
    const { pause } = this.waiting[index]
    return pause
      ? { kind: 'waiting', position, blockers, paused: { ...pause } }
      : { kind: 'waiting', position, blockers }
  }

  snapshot(): SpotlightTurnQueueSnapshot {
    const waiting: SpotlightTurnWaiter[] = []
    const paused: SpotlightTurnPausedWaiter[] = []
    for (const { pause, ...waiter } of this.waiting) {
      const copy = { ...waiter, repoIds: [...waiter.repoIds] }
      if (pause) {
        paused.push({ ...copy, ...pause })
      } else {
        waiting.push(copy)
      }
    }
    return { turns: [...this.turns.values()].map(snapshotTurn), waiting, paused }
  }

  /** Every pane holding a turn or keeping a place in line. */
  paneKeys(): string[] {
    const keys = new Set(this.waiting.map((waiter) => waiter.paneKey))
    for (const turn of this.turns.values()) {
      turn.paneKeys.forEach((paneKey) => keys.add(paneKey))
    }
    return [...keys]
  }

  private join(turn: MutableTurn, paneKey: string, repoIds: string[]): SpotlightTurnRequestOutcome {
    this.waiting = this.waiting.filter((waiter) => waiter.paneKey !== paneKey)
    turn.paneKeys.add(paneKey)
    // Why every waiter counts: anyone already in line asked before this pane did.
    const unavailable = this.claimedRepoIds(turn.taskKey)
    const extra = repoIds.filter((repoId) => !turn.repoIds.has(repoId))
    const added = extra.filter((repoId) => !unavailable.has(repoId))
    added.forEach((repoId) => turn.repoIds.add(repoId))
    // Why pump: leaving another task's turn on the way here may have freed projects for waiters.
    const freed = this.pump()
    return {
      position: { kind: 'holding', turn: snapshotTurn(turn) },
      skippedRepoIds: extra.filter((repoId) => unavailable.has(repoId)),
      granted: added.length > 0 ? [snapshotTurn(turn), ...freed] : freed
    }
  }

  /** Takes the pane out of every turn but `keepTaskKey`'s; a turn left with no pane ends. */
  private leaveTurns(paneKey: string, keepTaskKey: string | null): string | null {
    let leftTaskKey: string | null = null
    // Why no copy: deleting the entry being visited is safe while iterating a Map.
    for (const turn of this.turns.values()) {
      if (turn.taskKey !== keepTaskKey && turn.paneKeys.delete(paneKey)) {
        leftTaskKey = turn.taskKey
        if (turn.paneKeys.size === 0) {
          this.turns.delete(turn.taskKey)
        }
      }
    }
    return leftTaskKey
  }

  /** Projects another task holds or waits for; paused panes claim nothing. */
  private claimedRepoIds(taskKey: string): Set<string> {
    const claimed = new Set<string>()
    for (const turn of this.turns.values()) {
      if (turn.taskKey !== taskKey) {
        turn.repoIds.forEach((repoId) => claimed.add(repoId))
      }
    }
    for (const waiter of this.waiting) {
      if (waiter.taskKey !== taskKey && !waiter.pause) {
        waiter.repoIds.forEach((repoId) => claimed.add(repoId))
      }
    }
    return claimed
  }

  /** Grants whoever the line lets through; the cap is read once per pass. */
  private pump(): SpotlightTurn[] {
    const { line, granted } = pumpLine(this.turns, this.waiting, this.cap(), this.now)
    this.waiting = line
    return granted.map(snapshotTurn)
  }
}
