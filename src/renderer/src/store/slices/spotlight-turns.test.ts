import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SpotlightAgentStatus } from '../../../../shared/spotlight-agent-turn'
import { installApi } from '../../web/web-preload-api-test-harness'
import { subscribeSpotlightTurns } from './spotlight-turns'
import { createTestStore } from '../testing/app-store-test-fixture'

function boardOf(taskKeys: string[]): SpotlightAgentStatus {
  return {
    cap: 2,
    turns: taskKeys.map((taskKey, index) => ({
      taskKey,
      repoNames: ['orca'],
      panes: 1,
      grantedAt: 1_000 + index,
      paneKeys: [`tab-${taskKey}:leaf-1`]
    })),
    waiting: [],
    paused: [],
    lit: []
  }
}

function testingTaskKeys(store: ReturnType<typeof createTestStore>): string[] {
  return store.getState().spotlightTurns.turns.map((turn) => turn.taskKey)
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the test queue in the store', () => {
  it('takes the board main pushes', () => {
    const store = createTestStore()

    store.getState().applySpotlightTurns(boardOf(['AG-12']))

    expect(testingTaskKeys(store)).toEqual(['AG-12'])
  })

  it('keeps the current board when main pushes an equal one', () => {
    const store = createTestStore()
    const first = boardOf(['AG-12'])
    store.getState().applySpotlightTurns(first)

    store.getState().applySpotlightTurns(boardOf(['AG-12']))

    expect(store.getState().spotlightTurns).toBe(first)
  })

  it("reads main's board once, then follows its pushes", async () => {
    let push: (board: SpotlightAgentStatus) => void = () => {}
    const getTurns = vi.fn(async () => boardOf(['AG-12']))
    vi.stubGlobal('window', {
      api: {
        spotlight: {
          getTurns,
          onTurnsChanged: (listener: (board: SpotlightAgentStatus) => void) => {
            push = listener
            return () => {}
          }
        }
      }
    })
    const store = createTestStore()

    subscribeSpotlightTurns(store)
    await vi.waitFor(() => expect(testingTaskKeys(store)).toEqual(['AG-12']))
    push(boardOf(['AG-12', 'AX-7']))

    expect(testingTaskKeys(store)).toEqual(['AG-12', 'AX-7'])
    expect(getTurns).toHaveBeenCalledTimes(1)
  })

  it('hydrates an empty queue on web, where no turns run', async () => {
    await installApi()
    const store = createTestStore()
    store.getState().applySpotlightTurns(boardOf(['AG-12']))

    await store.getState().hydrateSpotlightTurns()

    const board = store.getState().spotlightTurns
    expect(board.turns).toEqual([])
    expect(board.waiting).toEqual([])
    expect(board.paused ?? []).toEqual([])
  })
})
