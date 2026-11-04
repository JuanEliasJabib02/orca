// @vitest-environment happy-dom
import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createStore, type StoreApi } from 'zustand/vanilla'
import type {
  SpotlightAgentPausedRow,
  SpotlightAgentStatus,
  SpotlightResumeAccountPick
} from '../../../shared/spotlight-agent-turn'

type ContinueResult = { delivered: boolean; pick?: SpotlightResumeAccountPick }

// Only what auto-resume reads and calls; Continuar itself is T5b's and is recorded, not run.
type TestState = {
  settings: { spotlightAutoResumeAfterUsageLimit?: boolean } | null
  spotlightTurns: SpotlightAgentStatus
  continueTestTask: (paneKey: string, options: { auto: boolean }) => Promise<ContinueResult>
}

const harness = vi.hoisted(() => ({ store: undefined as StoreApi<TestState> | undefined }))

vi.mock('@/store', () => ({
  useAppStore: {
    getState: () => harness.store?.getState(),
    subscribe: (listener: (state: TestState, previous: TestState) => void) =>
      harness.store?.subscribe(listener)
  }
}))

import { useTestQueueAutoResume } from './use-test-queue-auto-resume'

const NOW = Date.UTC(2026, 10, 4, 21, 0)
const PANE = 'tab-1:3f2504e0-4f89-41d3-9a0c-0305e82c3301'
const OTHER_PANE = 'tab-2:9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d'
const PAUSED_AT = NOW - 1_000
const PERSONAL: SpotlightResumeAccountPick = {
  kind: 'account',
  accountId: 'personal',
  label: 'personal'
}

const continueTestTask = vi.fn<TestState['continueTestTask']>()
const dispatch = vi.fn(async (_request: Record<string, unknown>) => ({ delivered: true }))
let hook: { unmount: () => void } | null = null

function pausedRow(overrides: Partial<SpotlightAgentPausedRow> = {}): SpotlightAgentPausedRow {
  return {
    paneKey: PANE,
    taskKey: 'AG-12',
    repoNames: ['arctic-grey'],
    laneKey: 'ag',
    since: NOW - 60_000,
    reason: 'limit',
    pausedAt: PAUSED_AT,
    ...overrides
  }
}

function board(paused: SpotlightAgentPausedRow[]): SpotlightAgentStatus {
  return { turns: [], waiting: [], paused, lit: [] }
}

function mount(paused: SpotlightAgentPausedRow[], autoResume = true): void {
  harness.store = createStore<TestState>()(() => ({
    settings: { spotlightAutoResumeAfterUsageLimit: autoResume },
    spotlightTurns: board(paused),
    continueTestTask
  }))
  hook = renderHook(() => useTestQueueAutoResume())
}

/** Main pushes the board after a queue change. */
function push(...paused: SpotlightAgentPausedRow[]): void {
  harness.store?.setState({ spotlightTurns: board(paused) })
}

/** Lets an awaited Continuar and its notice finish. */
async function settle(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0)
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  continueTestTask.mockReset()
  continueTestTask.mockResolvedValue({ delivered: true, pick: PERSONAL })
  dispatch.mockClear()
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: { notifications: { dispatch } }
  })
})

afterEach(() => {
  hook?.unmount()
  hook = null
  vi.useRealTimers()
})

describe('useTestQueueAutoResume', () => {
  it('leaves a paused pane alone while the switch is off, and resumes once on', async () => {
    mount([pausedRow()], false)
    await settle()

    expect(continueTestTask).not.toHaveBeenCalled()

    harness.store?.setState({ settings: { spotlightAutoResumeAfterUsageLimit: true } })
    await settle()

    expect(continueTestTask.mock.calls).toEqual([[PANE, { auto: true }]])
  })

  it('resumes a pane cut by its limit once and names the account in one notice', async () => {
    mount([pausedRow()])
    await settle()
    // Main opens the resume window, then settles it; the row stays paused until the agent asks.
    push(pausedRow({ resuming: true, autoResumes: 1 }))
    push(pausedRow({ autoResumes: 1 }))
    await settle()

    expect(continueTestTask.mock.calls).toEqual([[PANE, { auto: true }]])
    expect(dispatch.mock.calls).toEqual([
      [
        {
          source: 'test-queue-auto-resume',
          worktreeLabel: 'AG-12',
          accountLabel: 'personal',
          attentionKey: `test-queue-auto-resume:${PANE}:${PAUSED_AT}`
        }
      ]
    ])
  })

  it('tries again one minute after the first account gets its limit back', async () => {
    continueTestTask.mockResolvedValueOnce({
      delivered: false,
      pick: { kind: 'none', returnsAt: NOW + 30 * 60_000 }
    })
    mount([pausedRow()])
    await settle()
    push(pausedRow({ autoResumes: 1 }))

    await vi.advanceTimersByTimeAsync(31 * 60_000 - 1)

    expect(continueTestTask).toHaveBeenCalledTimes(1)
    expect(dispatch).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    await settle()

    expect(continueTestTask).toHaveBeenCalledTimes(2)
    expect(dispatch.mock.calls).toEqual([[expect.objectContaining({ accountLabel: 'personal' })]])
  })

  it('stops after three automatic resumes in a row', async () => {
    mount([])
    for (let resumes = 0; resumes <= 3; resumes++) {
      // Each resumed agent asked for its turn again and was cut again: a new pause each time.
      push()
      push(pausedRow({ pausedAt: PAUSED_AT + resumes, autoResumes: resumes }))
      await settle()
    }

    expect(continueTestTask).toHaveBeenCalledTimes(3)
  })

  it('leaves alone a pane already resuming and one stopped by another error', async () => {
    mount([pausedRow({ resuming: true }), pausedRow({ paneKey: OTHER_PANE, reason: 'error' })])
    await settle()

    expect(continueTestTask).not.toHaveBeenCalled()
  })

  it('resumes one pane at a time, since each can switch the active account', async () => {
    let finishFirst: (result: ContinueResult) => void = () => {}
    continueTestTask.mockImplementationOnce(
      () =>
        new Promise<ContinueResult>((resolve) => {
          finishFirst = resolve
        })
    )
    mount([pausedRow(), pausedRow({ paneKey: OTHER_PANE, taskKey: 'AX-3' })])
    await settle()

    expect(continueTestTask.mock.calls).toEqual([[PANE, { auto: true }]])

    finishFirst({ delivered: true, pick: PERSONAL })
    await settle()

    expect(continueTestTask.mock.calls).toEqual([
      [PANE, { auto: true }],
      [OTHER_PANE, { auto: true }]
    ])
  })
})
