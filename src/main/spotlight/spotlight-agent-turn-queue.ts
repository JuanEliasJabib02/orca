/** One agent pane asking for the Spotlight of every project its task needs. */
export type SpotlightTurnRequest = {
  paneKey: string
  taskKey: string
  repoIds: readonly string[]
}

/** A task holding the Spotlight of its projects; every pane of the task shares it. */
export type SpotlightTurn = {
  taskKey: string
  repoIds: string[]
  paneKeys: string[]
  grantedAt: number
}

export type SpotlightTurnWaiter = {
  paneKey: string
  taskKey: string
  repoIds: string[]
  since: number
}

/** Who stands between a waiter and its projects: a task holding them, or one queued earlier. */
export type SpotlightTurnBlocker = { taskKey: string; repoIds: string[]; holding: boolean }

export type SpotlightTurnPosition =
  | { kind: 'holding'; turn: SpotlightTurn }
  | { kind: 'waiting'; position: number; blockers: SpotlightTurnBlocker[] }

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

export type SpotlightTurnQueueSnapshot = {
  turns: SpotlightTurn[]
  waiting: SpotlightTurnWaiter[]
}

type MutableTurn = {
  taskKey: string
  repoIds: Set<string>
  paneKeys: Set<string>
  grantedAt: number
}

function overlaps(a: Iterable<string>, b: ReadonlySet<string>): string[] {
  return [...a].filter((repoId) => b.has(repoId))
}

/**
 * Who may light which projects' Spotlight. A task gets all its projects or waits for them (so two
 * tasks never hold half of each other's), first come first served per project: a later request
 * never overtakes an earlier one wanting the same project, but requests with no project in common
 * never wait for each other.
 */
export class SpotlightTurnQueue {
  private readonly turns = new Map<string, MutableTurn>()
  private waiting: SpotlightTurnWaiter[] = []

  constructor(private readonly now: () => number = Date.now) {}

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
      // Why in place: asking again keeps the place in line.
      queued.taskKey = request.taskKey
      queued.repoIds = repoIds
    } else {
      this.waiting.push({
        paneKey: request.paneKey,
        taskKey: request.taskKey,
        repoIds,
        since: this.now()
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

  /** Gives the pane's turn back, or its place in line. */
  release(paneKey: string): SpotlightTurnReleaseOutcome {
    const before = this.waiting.length
    this.waiting = this.waiting.filter((waiter) => waiter.paneKey !== paneKey)
    const wasWaiting = this.waiting.length !== before
    const releasedTaskKey = this.leaveTurns(paneKey, null)
    return { releasedTaskKey, wasWaiting, granted: this.pump() }
  }

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
    const waiter = this.waiting[index]
    const wanted = new Set(waiter.repoIds)
    const blockers: SpotlightTurnBlocker[] = []
    for (const turn of this.turns.values()) {
      const held = overlaps(turn.repoIds, wanted)
      if (turn.taskKey !== waiter.taskKey && held.length > 0) {
        blockers.push({ taskKey: turn.taskKey, repoIds: held, holding: true })
      }
    }
    let ahead = 0
    for (const earlier of this.waiting.slice(0, index)) {
      const contested = overlaps(earlier.repoIds, wanted)
      // Why skip the own task: its panes are granted together, never one ahead of another.
      if (earlier.taskKey !== waiter.taskKey && contested.length > 0) {
        ahead += 1
        blockers.push({ taskKey: earlier.taskKey, repoIds: contested, holding: false })
      }
    }
    return { kind: 'waiting', position: ahead + 1, blockers }
  }

  snapshot(): SpotlightTurnQueueSnapshot {
    return {
      turns: [...this.turns.values()].map(snapshotTurn),
      waiting: this.waiting.map((waiter) => ({ ...waiter, repoIds: [...waiter.repoIds] }))
    }
  }

  /** Every pane holding a turn or waiting for one. */
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

  /** Projects another task holds or waits for. */
  private claimedRepoIds(taskKey: string): Set<string> {
    const claimed = new Set<string>()
    for (const turn of this.turns.values()) {
      if (turn.taskKey !== taskKey) {
        turn.repoIds.forEach((repoId) => claimed.add(repoId))
      }
    }
    for (const waiter of this.waiting) {
      if (waiter.taskKey !== taskKey) {
        waiter.repoIds.forEach((repoId) => claimed.add(repoId))
      }
    }
    return claimed
  }

  private holderOf(repoId: string): string | null {
    for (const turn of this.turns.values()) {
      if (turn.repoIds.has(repoId)) {
        return turn.taskKey
      }
    }
    return null
  }

  private pump(): SpotlightTurn[] {
    const granted = new Map<string, MutableTurn>()
    // Projects an earlier waiter is still waiting for: nobody behind it may take them.
    const claimed = new Set<string>()
    const stillWaiting: SpotlightTurnWaiter[] = []
    for (const waiter of this.waiting) {
      const free = waiter.repoIds.every(
        (repoId) =>
          !claimed.has(repoId) && (this.holderOf(repoId) ?? waiter.taskKey) === waiter.taskKey
      )
      if (!free) {
        waiter.repoIds.forEach((repoId) => claimed.add(repoId))
        stillWaiting.push(waiter)
        continue
      }
      const turn = this.turns.get(waiter.taskKey) ?? {
        taskKey: waiter.taskKey,
        repoIds: new Set<string>(),
        paneKeys: new Set<string>(),
        grantedAt: this.now()
      }
      waiter.repoIds.forEach((repoId) => turn.repoIds.add(repoId))
      turn.paneKeys.add(waiter.paneKey)
      this.turns.set(turn.taskKey, turn)
      granted.set(turn.taskKey, turn)
    }
    this.waiting = stillWaiting
    return [...granted.values()].map(snapshotTurn)
  }
}

function snapshotTurn(turn: MutableTurn): SpotlightTurn {
  return {
    taskKey: turn.taskKey,
    repoIds: [...turn.repoIds],
    paneKeys: [...turn.paneKeys],
    grantedAt: turn.grantedAt
  }
}
