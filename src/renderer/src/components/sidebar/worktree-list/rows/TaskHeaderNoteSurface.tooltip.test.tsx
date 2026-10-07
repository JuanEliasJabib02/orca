// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useAppStore } from '@/store'
import type { TaskSectionInfo } from '../grouping/row-types'
import { TaskHeaderNoteSurface } from './TaskHeaderNoteSurface'

const initialState = useAppStore.getInitialState()
let container: HTMLDivElement
let root: Root

const TASK: TaskSectionInfo = {
  taskKey: 'AX-3423',
  title: 'Refund flow in the POS',
  worktrees: [],
  folderWorkspaceIds: []
}

async function renderHeader(): Promise<HTMLElement> {
  await act(async () => {
    root.render(
      <TooltipProvider>
        <TaskHeaderNoteSurface task={TASK}>
          <div role="button" tabIndex={0} data-header-row="">
            AX-3423
          </div>
        </TaskHeaderNoteSurface>
      </TooltipProvider>
    )
  })
  const row = container.querySelector<HTMLElement>('[data-header-row]')
  if (!row) {
    throw new Error('Header row not rendered')
  }
  return row
}

async function focusRow(row: HTMLElement): Promise<void> {
  await act(async () => {
    row.focus()
  })
}

describe('TaskHeaderNoteSurface with the real tooltip', () => {
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    useAppStore.setState(initialState, true)
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    document.body.innerHTML = ''
    useAppStore.setState(initialState, true)
  })

  it('shows the note, and nothing of the Jira title, when the header is focused', async () => {
    useAppStore.setState({ taskNoteByTaskKey: { 'AX-3423': 'POS Action Wear' } })
    const row = await renderHeader()

    await focusRow(row)

    const tooltip = document.body.querySelector('[data-slot="tooltip-content"]')
    expect(tooltip?.textContent).toContain('POS Action Wear')
    expect(tooltip?.textContent).not.toContain('Refund flow in the POS')
  })

  it('shows no tooltip for a task without a note', async () => {
    const row = await renderHeader()

    await focusRow(row)

    expect(document.body.querySelector('[data-slot="tooltip-content"]')).toBeNull()
  })

  it('keeps the same header element when a note is added', async () => {
    const row = await renderHeader()

    await act(async () => {
      useAppStore.setState({ taskNoteByTaskKey: { 'AX-3423': 'POS Action Wear' } })
    })

    expect(container.querySelector('[data-header-row]')).toBe(row)
  })
})
