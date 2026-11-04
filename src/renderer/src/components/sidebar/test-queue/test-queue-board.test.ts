import { describe, expect, it } from 'vitest'
import type { SpotlightAgentStatus } from '../../../../../shared/spotlight-agent-turn'
import {
  buildTestQueueBoardView,
  testQueueTaskStanding,
  type TestQueueBoardView
} from './test-queue-board'

const MINUTE = 60_000
const NOW = 1_000 * MINUTE

// Orca tests in Arrecife with two panes, AG and Action wait, expenses-logs ran out of limit, and
// one more pane of the testing task stopped on an error.
const BOARD: SpotlightAgentStatus = {
  cap: 2,
  turns: [
    {
      taskKey: 'queue-tester',
      repoNames: ['orca'],
      panes: 2,
      grantedAt: NOW - 30 * MINUTE,
      paneKeys: ['tab-a:leaf-1', 'tab-a:leaf-2'],
      laneKey: 'arrecife'
    }
  ],
  waiting: [
    {
      taskKey: 'AG-12',
      repoNames: ['arctic-grey'],
      since: NOW - 9 * MINUTE,
      paneKey: 'tab-b:leaf-1',
      laneKey: 'ag'
    },
    {
      taskKey: 'AX-7',
      repoNames: ['action-black'],
      since: NOW - 2 * MINUTE,
      paneKey: 'tab-c:leaf-1',
      laneKey: 'action'
    }
  ],
  paused: [
    {
      paneKey: 'tab-d:leaf-1',
      taskKey: 'expenses',
      repoNames: ['expenses-logs'],
      since: NOW - 40 * MINUTE,
      reason: 'limit',
      pausedAt: NOW - 5 * MINUTE
    },
    {
      paneKey: 'tab-a:leaf-3',
      taskKey: 'queue-tester',
      repoNames: ['orca'],
      since: NOW - 30 * MINUTE,
      reason: 'error',
      pausedAt: NOW - MINUTE
    }
  ],
  lit: []
}

function viewOf(
  agentStatusByPaneKey: Record<string, { updatedAt: number }> = {},
  taskName: (taskKey: string) => string | undefined = () => undefined
): TestQueueBoardView {
  return buildTestQueueBoardView({ board: BOARD, agentStatusByPaneKey, taskName, now: NOW })
}

describe('test queue board view', () => {
  it('counts the tasks testing and waiting, never the paused ones', () => {
    const view = viewOf()

    expect(view.count).toBe(3)
    expect(view.paused.map((row) => row.paneKey)).toEqual(['tab-d:leaf-1', 'tab-a:leaf-3'])
  })

  it('numbers the waiting tasks in line order, the same number their badge shows', () => {
    const view = viewOf()

    expect(view.waiting.map((row) => [row.taskKey, row.position])).toEqual([
      ['AG-12', 1],
      ['AX-7', 2]
    ])
    expect(testQueueTaskStanding(BOARD, 'AX-7')).toEqual({ kind: 'waiting', position: 2 })
    expect(testQueueTaskStanding(BOARD, 'expenses')).toEqual({ kind: 'paused' })
    // A testing task with one paused pane still tests.
    expect(testQueueTaskStanding(BOARD, 'queue-tester')).toEqual({ kind: 'testing' })
    expect(testQueueTaskStanding(BOARD, 'unknown-task')).toBeNull()
  })

  it('flags a turn idle only once every one of its panes went 10 min without activity', () => {
    const oneActive = viewOf({
      'tab-a:leaf-1': { updatedAt: NOW - 25 * MINUTE },
      'tab-a:leaf-2': { updatedAt: NOW - 4 * MINUTE }
    })
    const bothQuiet = viewOf({
      'tab-a:leaf-1': { updatedAt: NOW - 25 * MINUTE },
      'tab-a:leaf-2': { updatedAt: NOW - 12 * MINUTE }
    })

    expect(oneActive.testing[0].idleMinutes).toBeNull()
    expect(bothQuiet.testing[0].idleMinutes).toBe(12)
  })

  it('counts idle time from the grant when the agents went quiet while waiting in line', () => {
    const view = buildTestQueueBoardView({
      board: {
        ...BOARD,
        turns: [{ ...BOARD.turns[0], grantedAt: NOW - 3 * MINUTE, paneKeys: ['tab-a:leaf-1'] }]
      },
      agentStatusByPaneKey: { 'tab-a:leaf-1': { updatedAt: NOW - 30 * MINUTE } },
      taskName: () => undefined,
      now: NOW
    })

    expect(view.testing[0].idleMinutes).toBeNull()
  })

  it('names each task from the task list and falls back to its key', () => {
    const view = viewOf({}, (taskKey) => (taskKey === 'AG-12' ? 'Checkout redesign' : undefined))

    expect(view.waiting.map((row) => row.taskName)).toEqual(['Checkout redesign', 'AX-7'])
  })
})
