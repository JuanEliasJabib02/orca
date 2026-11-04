// The test queue as the footer monitor and the task badges draw it: one reading of main's board.
import type { AgentStatusEntry } from '../../../../../shared/agent-status/contracts/agent-status-types'
import type {
  SpotlightAgentPausedRow,
  SpotlightAgentStatus,
  SpotlightAgentTurnRow,
  SpotlightAgentWaitingRow
} from '../../../../../shared/spotlight-agent-turn'

const MINUTE_MS = 60_000
/** A turn shows `sin actividad hace N min` once every pane went this long without activity. */
const IDLE_AFTER_MS = 10 * MINUTE_MS

export type TestQueueTestingRow = SpotlightAgentTurnRow & {
  taskName: string
  /** Minutes since the turn's newest activity once it is idle; null while any pane is active. */
  idleMinutes: number | null
}

export type TestQueueWaitingRow = SpotlightAgentWaitingRow & {
  taskName: string
  /** `En cola #n`: 1 = next in line. */
  position: number
}

export type TestQueuePausedRow = SpotlightAgentPausedRow & { taskName: string }

export type TestQueueBoardView = {
  /** The footer number: tasks testing plus tasks waiting; paused ones never count. */
  count: number
  testing: TestQueueTestingRow[]
  waiting: TestQueueWaitingRow[]
  /** One row per paused pane, in line order. */
  paused: TestQueuePausedRow[]
}

/** A task header's badge: `Probando`, `En cola #n` or `Pausado`. */
export type TestQueueTaskStanding =
  | { kind: 'testing' }
  | { kind: 'waiting'; position: number }
  | { kind: 'paused' }

/**
 * Where a task stands; testing wins over waiting and waiting over paused, since one pane of a
 * task can pause while another keeps its turn. Null when the task is not in the queue.
 */
export function testQueueTaskStanding(
  board: SpotlightAgentStatus,
  taskKey: string
): TestQueueTaskStanding | null {
  if (board.turns.some((turn) => turn.taskKey === taskKey)) {
    return { kind: 'testing' }
  }
  const index = board.waiting.findIndex((row) => row.taskKey === taskKey)
  if (index !== -1) {
    return { kind: 'waiting', position: index + 1 }
  }
  return board.paused?.some((row) => row.taskKey === taskKey) ? { kind: 'paused' } : null
}

export type TestQueueBoardSources = {
  board: SpotlightAgentStatus
  /** The renderer's agent statuses; tool and prompt pings advance `updatedAt`. */
  agentStatusByPaneKey: Readonly<Record<string, Pick<AgentStatusEntry, 'updatedAt'> | undefined>>
  /** The task's name in the task list; none falls back to its key. */
  taskName: (taskKey: string) => string | null | undefined
  /** The minute ticker's clock. */
  now: number
}

/**
 * Idle counts from the grant at the earliest: an agent waiting in line sits in `orca spotlight on`
 * without reporting, so its last status predates the turn.
 */
function idleMinutesOf(
  turn: SpotlightAgentTurnRow,
  agentStatusByPaneKey: TestQueueBoardSources['agentStatusByPaneKey'],
  now: number
): number | null {
  let newest = turn.grantedAt
  for (const paneKey of turn.paneKeys ?? []) {
    newest = Math.max(newest, agentStatusByPaneKey[paneKey]?.updatedAt ?? newest)
  }
  const quietMs = now - newest
  return quietMs >= IDLE_AFTER_MS ? Math.floor(quietMs / MINUTE_MS) : null
}

export function buildTestQueueBoardView(sources: TestQueueBoardSources): TestQueueBoardView {
  const { board, agentStatusByPaneKey, now } = sources
  const nameOf = (taskKey: string): string => sources.taskName(taskKey) || taskKey
  const testing = board.turns.map((turn) => ({
    ...turn,
    taskName: nameOf(turn.taskKey),
    idleMinutes: idleMinutesOf(turn, agentStatusByPaneKey, now)
  }))
  const waiting = board.waiting.map((row, index) => ({
    ...row,
    taskName: nameOf(row.taskKey),
    position: index + 1
  }))
  const paused = (board.paused ?? []).map((row) => ({ ...row, taskName: nameOf(row.taskKey) }))
  return { count: testing.length + waiting.length, testing, waiting, paused }
}
