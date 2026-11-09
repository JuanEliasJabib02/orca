// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '@/store'
import type { AppState } from '@/store/types'
import { createProjectGroup } from '../../../../../shared/project-groups'
import type {
  SpotlightAgentPausedRow,
  SpotlightAgentStatus,
  SpotlightAgentTurnRow,
  SpotlightResumeAccountPick
} from '../../../../../shared/spotlight-agent-turn'
import { makeAgentStatusEntry } from '../../../runtime/sync-runtime-graph/testing/sync-runtime-graph-test-harness'
import { TestQueuePopover } from './TestQueuePopover'

type ContinueTestTask = AppState['continueTestTask']

const MINUTE = 60_000
const initialState = useAppStore.getInitialState()
const roots: Root[] = []

const arrecife = createProjectGroup({ name: 'Arrecife', createdFrom: 'manual', tabOrder: 0 })
const ag = createProjectGroup({ name: 'AG', createdFrom: 'manual', tabOrder: 1 })

const PERSONAL: SpotlightResumeAccountPick = {
  kind: 'account',
  accountId: 'acct-personal',
  label: 'personal'
}

let pickResumeAccount: ReturnType<typeof vi.fn<() => Promise<SpotlightResumeAccountPick>>>
let releaseTurn: ReturnType<typeof vi.fn<(paneKey: string) => Promise<void>>>
let continueTestTask: ReturnType<typeof vi.fn<ContinueTestTask>>

function orcaTurnAt(now: number): SpotlightAgentTurnRow {
  return {
    taskKey: 'queue-tester',
    repoNames: ['orca'],
    panes: 1,
    grantedAt: now - 3 * MINUTE,
    paneKeys: ['tab-a:leaf-1'],
    laneKey: arrecife.id
  }
}

function expensesPausedAt(now: number): SpotlightAgentPausedRow {
  return {
    paneKey: 'tab-d:leaf-1',
    taskKey: 'expenses-logs',
    repoNames: ['expenses-logs'],
    laneKey: arrecife.id,
    since: now - 40 * MINUTE,
    reason: 'limit',
    pausedAt: now - 5 * MINUTE
  }
}

// Orca tests in Arrecife, AG waits, and expenses-logs ran out of limit.
function boardAt(now: number): SpotlightAgentStatus {
  return {
    cap: 2,
    turns: [orcaTurnAt(now)],
    waiting: [
      {
        taskKey: 'AG-12',
        repoNames: ['arctic-grey'],
        since: now - 9 * MINUTE - 30_000,
        paneKey: 'tab-b:leaf-1',
        laneKey: ag.id
      }
    ],
    paused: [expensesPausedAt(now)],
    lit: []
  }
}

function setBoard(board: SpotlightAgentStatus): void {
  useAppStore.setState({ spotlightTurns: board })
}

// Lets the account pick's promise land before the next assertion.
async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 5; tick += 1) {
      await Promise.resolve()
    }
  })
}

async function mountPopover(): Promise<HTMLElement> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  await act(async () => {
    root.render(<TestQueuePopover />)
  })
  await settle()
  return container
}

function sectionsIn(container: HTMLElement): [string | null, string[]][] {
  return Array.from(container.querySelectorAll('[data-test-queue-section]')).map((section) => [
    section.getAttribute('data-test-queue-section'),
    Array.from(section.querySelectorAll('[data-test-queue-row-name]')).map(
      (name) => name.textContent ?? ''
    )
  ])
}

function buttonNamed(container: HTMLElement, label: string): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll('button')).find(
    (button) => button.textContent === label
  )
}

describe('TestQueuePopover', () => {
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    pickResumeAccount = vi.fn<() => Promise<SpotlightResumeAccountPick>>(() =>
      Promise.resolve(PERSONAL)
    )
    releaseTurn = vi.fn<(paneKey: string) => Promise<void>>(() => Promise.resolve())
    continueTestTask = vi.fn<ContinueTestTask>(() => Promise.resolve({ delivered: true }))
    vi.stubGlobal('api', { spotlight: { pickResumeAccount, releaseTurn } })
    useAppStore.setState(initialState, true)
    useAppStore.setState({ projectGroups: [arrecife, ag], continueTestTask })
  })

  afterEach(async () => {
    for (const root of roots.splice(0)) {
      await act(async () => root.unmount())
    }
    document.body.innerHTML = ''
    vi.useRealTimers()
    vi.unstubAllGlobals()
    useAppStore.setState(initialState, true)
  })

  it('lists who tests, waits and is paused, each row with its projects and space', async () => {
    setBoard(boardAt(Date.now()))

    const container = await mountPopover()

    expect(sectionsIn(container)).toEqual([
      ['testing', ['queue-tester']],
      ['waiting', ['AG-12']],
      ['paused', ['expenses-logs']]
    ])
    const waitingMeta = container.querySelector(
      '[data-test-queue-section="waiting"] [data-test-queue-row-meta]'
    )
    expect(waitingMeta?.textContent).toBe('arctic-grey · AG · waiting 9 min')
  })

  it('shows only the sections that have tasks', async () => {
    setBoard({ ...boardAt(Date.now()), turns: [], paused: [] })
    const container = await mountPopover()

    expect(sectionsIn(container)).toEqual([['waiting', ['AG-12']]])

    await act(async () => setBoard({ cap: 2, turns: [], waiting: [], paused: [], lit: [] }))

    expect(sectionsIn(container)).toEqual([])
  })

  it('names the account Continue resumes a paused task with, and resumes that pane', async () => {
    let settleContinue: (result: { delivered: boolean }) => void = () => {}
    continueTestTask.mockImplementation(
      () =>
        new Promise((resolve) => {
          settleContinue = resolve
        })
    )
    setBoard(boardAt(Date.now()))
    const container = await mountPopover()

    await act(async () => buttonNamed(container, 'Continue with personal')?.click())

    expect(continueTestTask).toHaveBeenCalledWith('tab-d:leaf-1', { auto: false })
    expect(buttonNamed(container, 'Resuming…')?.disabled).toBe(true)

    await act(async () => settleContinue({ delivered: false }))

    expect(buttonNamed(container, 'Continue with personal')?.disabled).toBe(false)
  })

  it('shows Resuming… on a paused row main is already resuming', async () => {
    const now = Date.now()
    setBoard({ ...boardAt(now), paused: [{ ...expensesPausedAt(now), resuming: true }] })

    const container = await mountPopover()

    expect(buttonNamed(container, 'Resuming…')?.disabled).toBe(true)
    expect(buttonNamed(container, 'Continue with personal')).toBeUndefined()
  })

  it('keeps Continue off while no account has limit, showing when the first returns', async () => {
    const returnsAt = new Date(2026, 10, 4, 16, 40).getTime()
    pickResumeAccount.mockResolvedValue({ kind: 'none', returnsAt })
    setBoard(boardAt(Date.now()))

    const container = await mountPopover()

    const backAt = Array.from(container.querySelectorAll('button')).find((button) =>
      /^Back at 4:40\sPM$/.test(button.textContent ?? '')
    )
    expect(backAt?.disabled).toBe(true)
  })

  it('turns Continue on once the first account gets its limit back', async () => {
    vi.useFakeTimers()
    const now = Date.now()
    pickResumeAccount
      .mockResolvedValueOnce({ kind: 'none', returnsAt: now + 4 * MINUTE })
      .mockResolvedValueOnce(PERSONAL)
    setBoard(boardAt(now))
    const container = await mountPopover()
    expect(buttonNamed(container, 'Continue with personal')).toBeUndefined()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * MINUTE + 1_000)
    })
    await settle()

    expect(buttonNamed(container, 'Continue with personal')?.disabled).toBe(false)
  })

  it('offers Continue and Release turn once every pane of a turn went 10 min quiet', async () => {
    const now = Date.now()
    setBoard({
      ...boardAt(now),
      turns: [
        {
          ...orcaTurnAt(now),
          panes: 2,
          grantedAt: now - 30 * MINUTE,
          paneKeys: ['tab-a:leaf-1', 'tab-a:leaf-2']
        }
      ],
      paused: []
    })
    useAppStore.setState({
      agentStatusByPaneKey: {
        'tab-a:leaf-1': makeAgentStatusEntry({
          paneKey: 'tab-a:leaf-1',
          updatedAt: now - 20 * MINUTE
        }),
        'tab-a:leaf-2': makeAgentStatusEntry({
          paneKey: 'tab-a:leaf-2',
          updatedAt: now - 12 * MINUTE
        })
      }
    })
    const container = await mountPopover()

    await act(async () => buttonNamed(container, 'Continue')?.click())
    // The pane that asked last is the one Continue writes to.
    expect(continueTestTask).toHaveBeenCalledWith('tab-a:leaf-2', { auto: false })

    await act(async () => buttonNamed(container, 'Release turn')?.click())
    expect(releaseTurn).toHaveBeenCalledWith('tab-a:leaf-1')
    expect(releaseTurn).toHaveBeenCalledWith('tab-a:leaf-2')
  })

  it('leaves a turn with recent activity without Continue or Release turn', async () => {
    const now = Date.now()
    setBoard({
      ...boardAt(now),
      turns: [{ ...orcaTurnAt(now), grantedAt: now - 30 * MINUTE }],
      paused: []
    })
    useAppStore.setState({
      agentStatusByPaneKey: {
        'tab-a:leaf-1': makeAgentStatusEntry({
          paneKey: 'tab-a:leaf-1',
          updatedAt: now - 2 * MINUTE
        })
      }
    })

    const container = await mountPopover()

    expect(sectionsIn(container)[0]).toEqual(['testing', ['queue-tester']])
    expect(buttonNamed(container, 'Continue')).toBeUndefined()
    expect(buttonNamed(container, 'Release turn')).toBeUndefined()
  })
})
