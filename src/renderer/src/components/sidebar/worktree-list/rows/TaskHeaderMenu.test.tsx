// @vitest-environment happy-dom

import type { ReactNode } from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '@/store'
import type { TaskSectionInfo } from '../grouping/row-types'
import { TaskHeaderMenu } from './TaskHeaderMenu'
import { makeTaskWorktree } from './task-spotlight-test-fixtures'

const runWorktreeBatchDelete = vi.hoisted(() => vi.fn())

vi.mock('../../delete-worktree-flow', () => ({ runWorktreeBatchDelete }))

// Why: Radix menus need real pointer events to open; render them inline so the item is reachable.
vi.mock('@/components/ui/dropdown-menu', async () => {
  const React_ = await import('react')
  const passthrough = ({ children }: { children?: ReactNode }) =>
    React_.createElement(React_.Fragment, null, children)
  return {
    DropdownMenu: passthrough,
    DropdownMenuTrigger: passthrough,
    DropdownMenuContent: passthrough,
    DropdownMenuItem: ({
      children,
      disabled,
      onSelect
    }: {
      children?: ReactNode
      disabled?: boolean
      onSelect?: () => void
    }) =>
      React_.createElement(
        'button',
        { 'data-menu-item': '', disabled, onClick: () => onSelect?.() },
        children
      )
  }
})

const initialState = useAppStore.getInitialState()
const roots: Root[] = []

const TASK: TaskSectionInfo = {
  taskKey: 'AX-3450',
  title: null,
  worktrees: [
    { worktreeId: 'be-main', repoId: 'backend' },
    { worktreeId: 'be-1', repoId: 'backend' },
    { worktreeId: 'ad-1', repoId: 'admin' }
  ],
  folderWorkspaceIds: []
}

function seedStore(): void {
  useAppStore.setState({
    worktreesByRepo: {
      backend: [
        makeTaskWorktree('be-main', 'backend', { isMainWorktree: true }),
        makeTaskWorktree('be-1', 'backend', { instanceId: 'inst-be' })
      ],
      admin: [makeTaskWorktree('ad-1', 'admin', { instanceId: 'inst-ad' })]
    }
  })
}

async function render(task: TaskSectionInfo = TASK, onParentClick = vi.fn()): Promise<HTMLElement> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  await act(async () => {
    root.render(
      // Stands in for the header row, whose click collapses the section.
      <div onClick={onParentClick}>
        <TaskHeaderMenu task={task} />
      </div>
    )
  })
  return container
}

function getTrigger(container: HTMLElement): HTMLButtonElement | null {
  return container.querySelector<HTMLButtonElement>('[data-repo-header-action]')
}

function getDeleteItem(container: HTMLElement): HTMLButtonElement | null {
  return container.querySelector<HTMLButtonElement>('[data-menu-item]')
}

describe('TaskHeaderMenu', () => {
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

  it('renders nothing for the "No task" section', async () => {
    seedStore()

    const container = await render({ ...TASK, taskKey: null })

    expect(container.querySelector('button')).toBeNull()
  })

  it('names the task on its trigger and offers "Delete task…"', async () => {
    seedStore()

    const container = await render()

    expect(getTrigger(container)?.getAttribute('aria-label')).toBe('Task actions for AX-3450')
    expect(getDeleteItem(container)?.textContent).toBe('Delete task…')
  })

  it('opens the batch delete for every non-main worktree of the task, always confirming', async () => {
    seedStore()
    const container = await render()

    await act(async () => {
      getDeleteItem(container)?.click()
    })

    expect(runWorktreeBatchDelete).toHaveBeenCalledTimes(1)
    expect(runWorktreeBatchDelete).toHaveBeenCalledWith(
      [
        { id: 'be-1', instanceId: 'inst-be', hostId: undefined },
        { id: 'ad-1', instanceId: 'inst-ad', hostId: undefined }
      ],
      { forceConfirm: true }
    )
  })

  it('disables the delete when the task holds only main worktrees', async () => {
    useAppStore.setState({
      worktreesByRepo: {
        backend: [makeTaskWorktree('be-main', 'backend', { isMainWorktree: true })]
      }
    })
    const container = await render({
      ...TASK,
      worktrees: [{ worktreeId: 'be-main', repoId: 'backend' }]
    })

    expect(getDeleteItem(container)?.disabled).toBe(true)

    await act(async () => {
      getDeleteItem(container)?.click()
    })

    expect(runWorktreeBatchDelete).not.toHaveBeenCalled()
  })

  it('keeps a trigger click from collapsing the section', async () => {
    seedStore()
    const onParentClick = vi.fn()
    const container = await render(TASK, onParentClick)

    await act(async () => {
      getTrigger(container)?.click()
    })

    expect(onParentClick).not.toHaveBeenCalled()
  })
})
