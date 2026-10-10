// @vitest-environment happy-dom

import type { ReactNode } from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '@/store'
import type { Worktree } from '../../../../../../shared/worktree/types'
import type { TaskSectionInfo } from '../grouping/row-types'
import { TaskHeaderMenu } from './TaskHeaderMenu'
import { spaceFilterStoreState } from '../../sidebar-space-project-filter-fixtures'
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
    DropdownMenuSeparator: () => null,
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
const uiSet = vi.fn(() => Promise.resolve())

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

/** A worktree whose branch carries the task's ticket key. */
function makeMember(id: string, repoId: string, overrides: Partial<Worktree> = {}): Worktree {
  return makeTaskWorktree(id, repoId, { branch: 'refs/heads/AX-3450-pos', ...overrides })
}

function seedStore(): void {
  useAppStore.setState({
    worktreesByRepo: {
      backend: [
        makeMember('be-main', 'backend', { isMainWorktree: true }),
        makeMember('be-1', 'backend', { instanceId: 'inst-be' })
      ],
      admin: [makeMember('ad-1', 'admin', { instanceId: 'inst-ad' })]
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

function getMenuItems(container: HTMLElement): HTMLButtonElement[] {
  return Array.from(container.querySelectorAll<HTMLButtonElement>('[data-menu-item]'))
}

function getDeleteItem(container: HTMLElement): HTMLButtonElement | null {
  return getMenuItems(container).find((item) => item.textContent === 'Delete task…') ?? null
}

function getNoteItem(container: HTMLElement): HTMLButtonElement | null {
  return getMenuItems(container).find((item) => /^(Add|Edit) note…$/.test(item.textContent)) ?? null
}

/** The `onDeleted` callback the delete flow was handed; the flow calls it as worktrees go. */
function getOnDeleted(): (targets: { id: string; executionHostId: null }[]) => void {
  const options = runWorktreeBatchDelete.mock.calls[0]?.[1]
  if (typeof options?.onDeleted !== 'function') {
    throw new Error('runWorktreeBatchDelete was not given onDeleted')
  }
  return options.onDeleted
}

describe('TaskHeaderMenu', () => {
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    vi.clearAllMocks()
    vi.stubGlobal('api', { ui: { set: uiSet } })
    useAppStore.setState(initialState, true)
  })

  afterEach(async () => {
    for (const root of roots.splice(0)) {
      await act(async () => root.unmount())
    }
    document.body.innerHTML = ''
    vi.unstubAllGlobals()
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
      { forceConfirm: true, onDeleted: expect.any(Function) }
    )
  })

  it('also deletes members that sidebar filters hide from the section', async () => {
    seedStore()
    // Why: the section lists only the visible member; the admin worktree is filtered out.
    const filteredTask: TaskSectionInfo = {
      ...TASK,
      worktrees: [{ worktreeId: 'be-1', repoId: 'backend' }]
    }
    const container = await render(filteredTask)

    await act(async () => {
      getDeleteItem(container)?.click()
    })

    expect(runWorktreeBatchDelete).toHaveBeenCalledWith(
      [
        { id: 'be-1', instanceId: 'inst-be', hostId: undefined },
        { id: 'ad-1', instanceId: 'inst-ad', hostId: undefined }
      ],
      { forceConfirm: true, onDeleted: expect.any(Function) }
    )
  })

  it('disables the delete when the task holds only main worktrees', async () => {
    useAppStore.setState({
      worktreesByRepo: {
        backend: [makeMember('be-main', 'backend', { isMainWorktree: true })]
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

  describe('task note', () => {
    it('offers "Add note…" while the task has no note', async () => {
      seedStore()

      const container = await render()

      expect(getNoteItem(container)?.textContent).toBe('Add note…')
    })

    it('offers "Edit note…" once the task has a note', async () => {
      seedStore()
      useAppStore.setState({ taskNoteByTaskKey: { 'AX-3450': 'POS Action Wear' } })

      const container = await render()

      expect(getNoteItem(container)?.textContent).toBe('Edit note…')
    })

    it('opens the note dialog for the task', async () => {
      seedStore()
      const openModal = vi.fn()
      useAppStore.setState({ openModal })
      const container = await render()

      await act(async () => {
        getNoteItem(container)?.click()
      })

      expect(openModal).toHaveBeenCalledWith('edit-task-note', { taskKey: 'AX-3450' })
      expect(runWorktreeBatchDelete).not.toHaveBeenCalled()
    })

    it('removes the note once every worktree of the task was deleted', async () => {
      seedStore()
      useAppStore.setState({ taskNoteByTaskKey: { 'AX-3450': 'POS Action Wear', 'AX-1': 'Other' } })
      const container = await render()
      await act(async () => {
        getDeleteItem(container)?.click()
      })

      await act(async () => {
        getOnDeleted()([
          { id: 'be-1', executionHostId: null },
          { id: 'ad-1', executionHostId: null }
        ])
      })

      expect(useAppStore.getState().taskNoteByTaskKey).toEqual({ 'AX-1': 'Other' })
      expect(uiSet).toHaveBeenLastCalledWith({ taskNoteByTaskKey: { 'AX-1': 'Other' } })
    })

    it('keeps the note after a partial delete, and removes it when the rest follow', async () => {
      seedStore()
      useAppStore.setState({ taskNoteByTaskKey: { 'AX-3450': 'POS Action Wear' } })
      const container = await render()
      await act(async () => {
        getDeleteItem(container)?.click()
      })

      await act(async () => {
        getOnDeleted()([{ id: 'be-1', executionHostId: null }])
      })
      expect(useAppStore.getState().taskNoteByTaskKey).toEqual({ 'AX-3450': 'POS Action Wear' })

      await act(async () => {
        getOnDeleted()([{ id: 'ad-1', executionHostId: null }])
      })
      expect(useAppStore.getState().taskNoteByTaskKey).toEqual({})
    })

    it('keeps the note when only the visible members were deleted and a hidden one remains', async () => {
      seedStore()
      useAppStore.setState({ taskNoteByTaskKey: { 'AX-3450': 'POS Action Wear' } })
      const container = await render({
        ...TASK,
        worktrees: [{ worktreeId: 'be-1', repoId: 'backend' }]
      })
      await act(async () => {
        getDeleteItem(container)?.click()
      })

      await act(async () => {
        getOnDeleted()([{ id: 'be-1', executionHostId: null }])
      })

      expect(useAppStore.getState().taskNoteByTaskKey).toEqual({ 'AX-3450': 'POS Action Wear' })
    })

    describe('with a same-named task in another space', () => {
      const SIDEBAR_TASK: TaskSectionInfo = {
        taskKey: 'sidebar',
        title: null,
        worktrees: [{ worktreeId: 'wk-1', repoId: 'work-api' }],
        folderWorkspaceIds: []
      }

      function seedTwoSpaces(otherSpaceOverrides: Partial<Worktree> = {}): void {
        // Why displayName: the fixture's default (the id, e.g. "wk-1") reads as a ticket key.
        const named = (id: string, repoId: string, overrides: Partial<Worktree> = {}): Worktree =>
          makeTaskWorktree(id, repoId, {
            branch: 'refs/heads/sidebar',
            displayName: 'sidebar',
            instanceId: `inst-${id}`,
            ...overrides
          })
        useAppStore.setState({
          ...spaceFilterStoreState('work'),
          worktreesByRepo: {
            'work-api': [named('wk-1', 'work-api')],
            'personal-blog': [named('pb-1', 'personal-blog', otherSpaceOverrides)]
          },
          taskNoteByTaskKey: { sidebar: 'Sidebar note' }
        })
      }

      async function deleteInWorkSpace(): Promise<void> {
        const container = await render(SIDEBAR_TASK)
        await act(async () => {
          getDeleteItem(container)?.click()
        })
        await act(async () => {
          getOnDeleted()([{ id: 'wk-1', executionHostId: null }])
        })
      }

      it('deletes only the active space and keeps the note the other space still uses', async () => {
        seedTwoSpaces()

        await deleteInWorkSpace()

        expect(runWorktreeBatchDelete.mock.calls[0]?.[0]).toEqual([
          { id: 'wk-1', instanceId: 'inst-wk-1', hostId: undefined }
        ])
        expect(useAppStore.getState().taskNoteByTaskKey).toEqual({ sidebar: 'Sidebar note' })
      })

      it('removes the note when nothing of the task is left in any space', async () => {
        seedTwoSpaces({ isArchived: true })

        await deleteInWorkSpace()

        expect(useAppStore.getState().taskNoteByTaskKey).toEqual({})
      })
    })

    it('keeps the note when the delete is cancelled', async () => {
      seedStore()
      useAppStore.setState({ taskNoteByTaskKey: { 'AX-3450': 'POS Action Wear' } })
      const container = await render()

      await act(async () => {
        getDeleteItem(container)?.click()
      })

      expect(useAppStore.getState().taskNoteByTaskKey).toEqual({ 'AX-3450': 'POS Action Wear' })
    })
  })
})
