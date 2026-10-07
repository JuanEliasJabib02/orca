// @vitest-environment happy-dom

import type { ReactNode } from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '@/store'
import type { TaskSectionInfo } from '../grouping/row-types'
import { TaskHeaderNoteSurface } from './TaskHeaderNoteSurface'

// Why: the real tooltip opens on a pointer timer; render its content inline so the text is observable.
vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: ReactNode }) => (
    <div data-tooltip-content="">{children}</div>
  )
}))

const initialState = useAppStore.getInitialState()
const roots: Root[] = []

const TASK: TaskSectionInfo = {
  taskKey: 'AX-3423',
  title: 'Refund flow in the POS',
  worktrees: [{ worktreeId: 'be-1', repoId: 'backend' }],
  folderWorkspaceIds: []
}

async function render(
  task: TaskSectionInfo | undefined = TASK,
  onRowClick = vi.fn()
): Promise<HTMLElement> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  await act(async () => {
    root.render(
      <TaskHeaderNoteSurface task={task}>
        <div role="button" data-header-row="" onClick={onRowClick}>
          AX-3423
        </div>
      </TaskHeaderNoteSurface>
    )
  })
  return container
}

function getRow(container: HTMLElement): HTMLElement {
  const row = container.querySelector<HTMLElement>('[data-header-row]')
  if (!row) {
    throw new Error('Header row not rendered')
  }
  return row
}

async function rightClick(element: HTMLElement): Promise<void> {
  await act(async () => {
    element.dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 20, clientY: 12 })
    )
  })
}

function getMenuItem(): HTMLElement | null {
  return document.body.querySelector<HTMLElement>('[data-slot="context-menu-item"]')
}

describe('TaskHeaderNoteSurface', () => {
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    vi.clearAllMocks()
    useAppStore.setState(initialState, true)
  })

  afterEach(async () => {
    for (const root of roots.splice(0)) {
      await act(async () => root.unmount())
    }
    document.body.innerHTML = ''
    useAppStore.setState(initialState, true)
  })

  it('shows the note, and only the note, in the tooltip', async () => {
    useAppStore.setState({ taskNoteByTaskKey: { 'AX-3423': 'POS Action Wear' } })

    const container = await render()

    expect(container.querySelector('[data-tooltip-content]')?.textContent).toBe('POS Action Wear')
    expect(container.textContent).not.toContain('Refund flow in the POS')
  })

  it('has no tooltip when the task has no note, even with a linked Jira title', async () => {
    useAppStore.setState({ taskNoteByTaskKey: { 'AX-9999': 'Another task' } })

    const container = await render()

    expect(container.querySelector('[data-tooltip-content]')).toBeNull()
  })

  it('does not change the header it wraps', async () => {
    useAppStore.setState({ taskNoteByTaskKey: { 'AX-3423': 'POS Action Wear' } })

    const container = await render()

    expect(container.firstElementChild).toBe(getRow(container))
    expect(getRow(container).textContent).toBe('AX-3423')
  })

  it('renders the "No task" header untouched', async () => {
    useAppStore.setState({ taskNoteByTaskKey: { 'AX-3423': 'POS Action Wear' } })

    const container = await render({ ...TASK, taskKey: null })
    await rightClick(getRow(container))

    expect(container.querySelector('[data-tooltip-content]')).toBeNull()
    expect(getMenuItem()).toBeNull()
  })

  it('offers "Add note…" on right-click and opens the note dialog for the task', async () => {
    const openModal = vi.fn()
    useAppStore.setState({ openModal })
    const container = await render()

    await rightClick(getRow(container))

    expect(getMenuItem()?.textContent).toBe('Add note…')
    await act(async () => {
      getMenuItem()?.click()
    })
    expect(openModal).toHaveBeenCalledWith('edit-task-note', { taskKey: 'AX-3423' })
  })

  it('offers "Edit note…" once the task has a note', async () => {
    useAppStore.setState({ taskNoteByTaskKey: { 'AX-3423': 'POS Action Wear' } })
    const container = await render()

    await rightClick(getRow(container))

    expect(getMenuItem()?.textContent).toBe('Edit note…')
  })

  it('hides the tooltip while the right-click menu is open', async () => {
    useAppStore.setState({ taskNoteByTaskKey: { 'AX-3423': 'POS Action Wear' } })
    const container = await render()

    await rightClick(getRow(container))

    expect(container.querySelector('[data-tooltip-content]')).toBeNull()
  })

  it('keeps a right-click from collapsing the section, and a left click still reaches the row', async () => {
    const onRowClick = vi.fn()
    const container = await render(TASK, onRowClick)

    await rightClick(getRow(container))
    expect(onRowClick).not.toHaveBeenCalled()

    await act(async () => {
      getRow(container).click()
    })
    expect(onRowClick).toHaveBeenCalledTimes(1)
  })
})
