// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '@/store'
import type { SpotlightAgentStatus } from '../../../../../../shared/spotlight-agent-turn'
import type { TaskSectionInfo } from '../../../../../../shared/sidebar-list/row-types'
import { TaskSectionHeader } from './TaskSectionHeader'
import { TaskTestTurnBadge } from './TaskTestTurnBadge'

vi.mock('@/lib/spotlight-server-autostart', () => ({ applySpotlightEnvChange: vi.fn() }))
vi.mock('@/components/ui/dropdown-menu', async () => {
  const { inlineDropdownMenu } = await import('../../inline-dropdown-menu-fixture')
  return inlineDropdownMenu
})

const initialState = useAppStore.getInitialState()
const roots: Root[] = []

// Orca tests in Arrecife, AG and Action wait in that order, expenses-logs ran out of limit.
const BOARD: SpotlightAgentStatus = {
  cap: 2,
  turns: [
    {
      taskKey: 'queue-tester',
      repoNames: ['orca'],
      panes: 1,
      grantedAt: 1_000,
      paneKeys: ['tab-a:leaf-1'],
      laneKey: 'arrecife'
    }
  ],
  waiting: [
    {
      taskKey: 'AG-12',
      repoNames: ['arctic-grey'],
      since: 2_000,
      paneKey: 'tab-b:leaf-1',
      laneKey: 'ag'
    },
    {
      taskKey: 'AX-7',
      repoNames: ['action-black'],
      since: 3_000,
      paneKey: 'tab-c:leaf-1',
      laneKey: 'action'
    }
  ],
  paused: [
    {
      paneKey: 'tab-d:leaf-1',
      taskKey: 'expenses',
      repoNames: ['expenses-logs'],
      since: 500,
      reason: 'limit',
      pausedAt: 4_000
    }
  ],
  lit: []
}

async function mount(node: React.ReactNode): Promise<HTMLElement> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  await act(async () => {
    root.render(node)
  })
  return container
}

function badgeIn(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>('[data-task-test-turn]')
}

describe('TaskTestTurnBadge', () => {
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    vi.stubGlobal('api', { ui: { set: vi.fn(() => Promise.resolve()) } })
    useAppStore.setState(initialState, true)
    useAppStore.setState({ spotlightTurns: BOARD })
  })

  afterEach(async () => {
    for (const root of roots.splice(0)) {
      await act(async () => root.unmount())
    }
    document.body.innerHTML = ''
    vi.unstubAllGlobals()
    useAppStore.setState(initialState, true)
  })

  it('shows Testing for a task that holds a turn', async () => {
    const container = await mount(<TaskTestTurnBadge taskKey="queue-tester" />)

    expect(badgeIn(container)?.textContent).toBe('Testing')
  })

  it('numbers a waiting task by its place in line', async () => {
    const container = await mount(<TaskTestTurnBadge taskKey="AX-7" />)

    expect(badgeIn(container)?.textContent).toBe('Queued #2')
  })

  it('shows Paused for a task whose agent stopped mid-turn', async () => {
    const container = await mount(<TaskTestTurnBadge taskKey="expenses" />)

    expect(badgeIn(container)?.textContent).toBe('Paused')
  })

  it('renders nothing for a task outside the queue', async () => {
    const container = await mount(<TaskTestTurnBadge taskKey="AX-999" />)

    expect(badgeIn(container)).toBeNull()
  })

  it('renders nothing for the "No task" section', async () => {
    const container = await mount(<TaskTestTurnBadge taskKey={null} />)

    expect(badgeIn(container)).toBeNull()
  })

  it('moves up the line and starts testing as main pushes the queue', async () => {
    const container = await mount(<TaskTestTurnBadge taskKey="AX-7" />)

    await act(async () => {
      useAppStore.setState({
        spotlightTurns: {
          ...BOARD,
          turns: [{ ...BOARD.turns[0], taskKey: 'AG-12', grantedAt: 5_000 }],
          waiting: [BOARD.waiting[1]]
        }
      })
    })
    expect(badgeIn(container)?.textContent).toBe('Queued #1')

    await act(async () => {
      useAppStore.setState({
        spotlightTurns: {
          ...BOARD,
          turns: [{ ...BOARD.turns[0], taskKey: 'AX-7', grantedAt: 6_000 }],
          waiting: []
        }
      })
    })
    expect(badgeIn(container)?.textContent).toBe('Testing')
  })

  it('is shown in the task header', async () => {
    const task: TaskSectionInfo = {
      taskKey: 'AG-12',
      title: null,
      worktrees: [],
      folderWorkspaceIds: []
    }

    const container = await mount(<TaskSectionHeader task={task} />)

    expect(badgeIn(container)?.textContent).toBe('Queued #1')
  })
})
