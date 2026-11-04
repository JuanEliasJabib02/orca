import type {
  SpotlightTurn,
  SpotlightTurnBlocker,
  SpotlightTurnPause,
  SpotlightTurnWaiter
} from './spotlight-agent-turn-queue'

/** A task's turn as the queue keeps it. */
export type MutableTurn = {
  taskKey: string
  /** The lane of the pane that started the turn. */
  laneKey?: string
  repoIds: Set<string>
  paneKeys: Set<string>
  grantedAt: number
}

/** A pane's place in line; a paused one keeps it but claims nothing until it asks again. */
export type LineEntry = SpotlightTurnWaiter & { pause: SpotlightTurnPause | null }

type Contender = { taskKey: string; repoIds: Iterable<string>; laneKey?: string }

function overlaps(a: Iterable<string>, b: ReadonlySet<string>): string[] {
  return [...a].filter((repoId) => b.has(repoId))
}

export function snapshotTurn(turn: MutableTurn): SpotlightTurn {
  return {
    taskKey: turn.taskKey,
    repoIds: [...turn.repoIds],
    paneKeys: [...turn.paneKeys],
    grantedAt: turn.grantedAt,
    laneKey: turn.laneKey
  }
}

function holderOf(turns: ReadonlyMap<string, MutableTurn>, repoId: string): string | null {
  for (const turn of turns.values()) {
    if (turn.repoIds.has(repoId)) {
      return turn.taskKey
    }
  }
  return null
}

function laneTaken(turns: ReadonlyMap<string, MutableTurn>, laneKey: string | undefined): boolean {
  return laneKey !== undefined && [...turns.values()].some((turn) => turn.laneKey === laneKey)
}

/**
 * Grants, in line order, every waiter whose projects are free and unclaimed by an earlier waiter,
 * whose lane no other task holds, and for whom a slot is left under `cap`. A pane of a task that
 * already holds a turn joins it past lane and cap. Grants go into `turns`.
 */
export function pumpLine(
  turns: Map<string, MutableTurn>,
  line: readonly LineEntry[],
  cap: number,
  now: () => number
): { line: LineEntry[]; granted: MutableTurn[] } {
  const granted = new Map<string, MutableTurn>()
  // Projects an earlier waiter is still waiting for: nobody behind it may take them.
  const claimed = new Set<string>()
  const left: LineEntry[] = []
  for (const waiter of line) {
    // Why: a paused pane keeps its place but claims nothing until it asks again.
    if (waiter.pause) {
      left.push(waiter)
      continue
    }
    const ownTurn = turns.get(waiter.taskKey)
    const projectsFree = waiter.repoIds.every(
      (repoId) =>
        !claimed.has(repoId) && (holderOf(turns, repoId) ?? waiter.taskKey) === waiter.taskKey
    )
    const slotFree =
      ownTurn !== undefined || (!laneTaken(turns, waiter.laneKey) && turns.size < cap)
    if (!projectsFree || !slotFree) {
      // Why claim even when only the lane or the cap blocks: nobody behind may overtake it.
      waiter.repoIds.forEach((repoId) => claimed.add(repoId))
      left.push(waiter)
      continue
    }
    const turn = ownTurn ?? {
      taskKey: waiter.taskKey,
      laneKey: waiter.laneKey,
      repoIds: new Set<string>(),
      paneKeys: new Set<string>(),
      grantedAt: now()
    }
    waiter.repoIds.forEach((repoId) => turn.repoIds.add(repoId))
    turn.paneKeys.add(waiter.paneKey)
    turns.set(turn.taskKey, turn)
    granted.set(turn.taskKey, turn)
  }
  return { line: left, granted: [...granted.values()] }
}

/**
 * The place of `line[index]`: 1 + the earlier waiters of other tasks wanting what it waits for (a
 * project, its lane, or a slot while every slot is taken), plus who blocks it and why. Paused panes
 * block nobody.
 */
export function waitingPlace(
  turns: ReadonlyMap<string, MutableTurn>,
  line: readonly LineEntry[],
  index: number,
  cap: number
): { position: number; blockers: SpotlightTurnBlocker[] } {
  const waiter = line[index]
  const wanted = new Set(waiter.repoIds)
  // Why: a pane of a task holding a turn joins it past lane and cap.
  const slotted = turns.has(waiter.taskKey)
  const capFull = !slotted && turns.size >= cap
  const blockerOf = (other: Contender, holding: boolean): SpotlightTurnBlocker | null => {
    // Why skip the own task: its panes are granted together, never one ahead of another.
    if (other.taskKey === waiter.taskKey) {
      return null
    }
    const contested = overlaps(other.repoIds, wanted)
    if (contested.length > 0) {
      return { taskKey: other.taskKey, repoIds: contested, holding }
    }
    const sameLane = !slotted && waiter.laneKey !== undefined && other.laneKey === waiter.laneKey
    if (!sameLane && !capFull) {
      return null
    }
    const reason = sameLane ? 'lane' : 'cap'
    return { taskKey: other.taskKey, repoIds: [...other.repoIds], holding, reason }
  }
  const blockers = [...turns.values()].flatMap((turn) => blockerOf(turn, true) ?? [])
  let ahead = 0
  for (const earlier of line.slice(0, index)) {
    const blocker = earlier.pause ? null : blockerOf(earlier, false)
    if (blocker) {
      ahead += 1
      blockers.push(blocker)
    }
  }
  return { position: ahead + 1, blockers }
}
