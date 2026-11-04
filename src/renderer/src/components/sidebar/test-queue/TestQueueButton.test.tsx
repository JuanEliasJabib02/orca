// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useAppStore } from '@/store'
import { TooltipProvider } from '@/components/ui/tooltip'
import type { SpotlightAgentStatus } from '../../../../../shared/spotlight-agent-turn'
import { TestQueueButton } from './TestQueueButton'

const initialState = useAppStore.getInitialState()
const roots: Root[] = []

// Orca tests, AG and Action wait, expenses-logs ran out of limit.
const BOARD: SpotlightAgentStatus = {
  cap: 2,
  turns: [
    {
      taskKey: 'queue-tester',
      repoNames: ['orca'],
      panes: 1,
      grantedAt: 1_000,
      paneKeys: ['tab-a:leaf-1']
    }
  ],
  waiting: [
    { taskKey: 'AG-12', repoNames: ['arctic-grey'], since: 2_000, paneKey: 'tab-b:leaf-1' },
    { taskKey: 'AX-7', repoNames: ['action-black'], since: 3_000, paneKey: 'tab-c:leaf-1' }
  ],
  paused: [
    {
      paneKey: 'tab-d:leaf-1',
      taskKey: 'expenses-logs',
      repoNames: ['expenses-logs'],
      since: 500,
      reason: 'limit',
      pausedAt: 4_000
    }
  ],
  lit: []
}

async function mountButton(): Promise<HTMLButtonElement> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  await act(async () => {
    root.render(
      <TooltipProvider>
        <TestQueueButton />
      </TooltipProvider>
    )
  })
  const button = container.querySelector<HTMLButtonElement>('button')
  if (!button) {
    throw new Error('test queue button not rendered')
  }
  return button
}

describe('TestQueueButton', () => {
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    useAppStore.setState(initialState, true)
  })

  afterEach(async () => {
    for (const root of roots.splice(0)) {
      await act(async () => root.unmount())
    }
    document.body.innerHTML = ''
    useAppStore.setState(initialState, true)
  })

  it('counts the tasks testing and waiting, never the paused ones', async () => {
    useAppStore.setState({ spotlightTurns: BOARD })

    const button = await mountButton()

    expect(button.textContent).toBe('3')
  })

  it('shows no number while nobody tests or waits, even with a paused task', async () => {
    useAppStore.setState({ spotlightTurns: { ...BOARD, turns: [], waiting: [] } })

    const button = await mountButton()

    expect(button.textContent).toBe('')
  })

  it('follows the queue as main pushes it', async () => {
    useAppStore.setState({ spotlightTurns: BOARD })
    const button = await mountButton()

    await act(async () => {
      useAppStore.setState({
        spotlightTurns: { ...BOARD, turns: [{ ...BOARD.turns[0], taskKey: 'AG-12' }], waiting: [] }
      })
    })

    expect(button.textContent).toBe('1')
  })
})
