// @vitest-environment happy-dom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '@/store'
import type { ProjectGroup } from '../../../../shared/project-group-types'
import type { Repo } from '../../../../shared/repo-types'
import type { WorktreeMeta } from '../../../../shared/worktree/meta-types'
import type { WorkspaceStatus, Worktree } from '../../../../shared/worktree/types'
import type { WorktreeMetaBatchUpdate } from '../../store/slices/worktree-helpers'
import { getWorktreeHostIdentity } from '../../../../shared/worktree/host-qualified-identity'
import { makeWorktree } from '../../store/slices/store-test-helpers'
import WorkspaceKanbanDrawer from './WorkspaceKanbanDrawer'
import type { WorkspaceKanbanLaneView } from './workspace-kanban-search'

type GridCapture = {
  laneViews: ReadonlyMap<string, WorkspaceKanbanLaneView>
  laneFullWorktreeIds: ReadonlyMap<string, readonly string[]>
  selectedWorktreeIds: ReadonlySet<string>
  onSelectionGesture: (event: React.MouseEvent<HTMLElement>, cardId: string) => boolean
  onAssignWorkspaceStatus?: (worktreeIds: readonly string[], status: WorkspaceStatus) => void
}

type PointerDragCapture = {
  selectedWorktreeIds: ReadonlySet<string>
  onDropWorktreesInStatus: (args: {
    worktreeIds: readonly string[]
    status: string
    dropIndex: number
  }) => void
  onPinWorktrees: (worktreeIds: readonly string[]) => void
}

const { gridState, pointerDragState, hiddenIds } = vi.hoisted(() => ({
  gridState: { current: null as GridCapture | null },
  pointerDragState: { current: null as PointerDragCapture | null },
  hiddenIds: new Set<string>()
}))

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('sonner', () => ({ toast: { error: vi.fn(), warning: vi.fn() } }))
vi.mock('@/components/ui/sheet', () => ({
  Sheet: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SheetContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>
}))
vi.mock('./WorkspaceKanbanDrawerHeader', () => ({ default: () => <div /> }))
vi.mock('./WorkspaceKanbanLaneGrid', () => ({
  default: (props: GridCapture) => {
    gridState.current = props
    return <div />
  }
}))
vi.mock('./WorkspaceKanbanAreaSelectionOverlay', () => ({
  default: React.forwardRef<HTMLDivElement>((_, ref) => <div ref={ref} />)
}))
vi.mock('./WorkspaceKanbanPinDropTarget', () => ({ default: () => <div /> }))
// Why: stands in for the sidebar filters — the space and primaries as the real hook drops them,
// plus whatever a test hides as if a Projects or sleep filter did.
vi.mock('./use-visible-workspace-kanban-worktree-ids', () => ({
  useVisibleWorkspaceKanbanWorktreeIds: ({ allWorktrees }: { allWorktrees: readonly Worktree[] }) =>
    new Set(
      allWorktrees
        .filter(
          (worktree) =>
            !worktree.isMainWorktree &&
            worktree.repoId !== 'personal' &&
            !hiddenIds.has(worktree.id)
        )
        .map(getWorktreeHostIdentity)
    )
}))
vi.mock('./use-workspace-kanban-area-selection', () => ({
  useWorkspaceKanbanAreaSelection: () => ({ handleAreaSelectionPointerDown: vi.fn() })
}))
vi.mock('./use-workspace-kanban-column-resize', () => ({
  useWorkspaceKanbanColumnResize: () => ({
    columnWidth: 308,
    isResizingColumn: false,
    onColumnResizeStart: vi.fn(),
    onColumnResizeKeyDown: vi.fn()
  })
}))
vi.mock('./use-workspace-kanban-create-worktree', () => ({
  useWorkspaceKanbanCreateWorktree: () => ({ createWorktreeForStatus: vi.fn() })
}))
vi.mock('./use-workspace-kanban-shift-wheel-scroll', () => ({
  useWorkspaceKanbanShiftWheelScroll: vi.fn()
}))
vi.mock('./use-workspace-kanban-outside-dismiss', () => ({
  isWorkspaceBoardKeepOpenTarget: () => false,
  useWorkspaceKanbanOutsideDismiss: vi.fn()
}))
vi.mock('@/components/contextual-tours/use-contextual-tour', () => ({
  useContextualTour: vi.fn()
}))
vi.mock('./use-workspace-kanban-card-pointer-drag', () => ({
  useWorkspaceKanbanCardPointerDrag: (params: PointerDragCapture) => {
    pointerDragState.current = params
    return { isPointerDragActiveRef: { current: false }, onCardPointerDownCapture: vi.fn() }
  }
}))
vi.mock('./use-workspace-status-drop', () => ({ useWorkspaceStatusDocumentDrop: vi.fn() }))

type UpdateWorktreesMeta = (
  updates: readonly WorktreeMetaBatchUpdate[] | ReadonlyMap<string, Partial<WorktreeMeta>>
) => Promise<void>

const statuses = [
  { id: 'todo', label: 'Todo' },
  { id: 'in-progress', label: 'In progress' },
  { id: 'done', label: 'Done' }
]

function group(id: string, tabOrder: number): ProjectGroup {
  return {
    id,
    name: id,
    parentPath: null,
    parentGroupId: null,
    createdFrom: 'manual',
    tabOrder,
    isCollapsed: false,
    color: null,
    createdAt: 0,
    updatedAt: 0
  }
}

function repo(id: string, projectGroupId: string): Repo {
  return { id, path: `/${id}`, displayName: id, connectionId: null, projectGroupId } as Repo
}

function worktree(
  repoId: string,
  branch: string,
  workspaceStatus: string,
  overrides: Partial<Worktree> = {}
): Worktree {
  return makeWorktree({
    id: `${repoId}::/${branch}`,
    repoId,
    branch: `refs/heads/${branch}`,
    displayName: branch,
    hostId: 'local',
    workspaceStatus,
    ...overrides
  })
}

const api = worktree('api', 'juan/AX-3447', 'todo', { manualOrder: 30 })
const web = worktree('web', 'juan/AX-3447', 'in-progress')
// In the space but hidden from the board, e.g. by the Projects filter.
const admin = worktree('admin', 'juan/AX-3447', 'todo')
const primary = worktree('web', 'AX-3447', 'todo', { isMainWorktree: true })
const otherSpace = worktree('personal', 'juan/AX-3447', 'todo')
const loose = worktree('api', 'juan/chore', 'todo', { manualOrder: 10 })
const allWorktrees = [api, web, admin, primary, otherSpace, loose]

let container: HTMLDivElement
let root: Root
let updateWorktreesMeta: ReturnType<typeof vi.fn<UpdateWorktreesMeta>>

function renderDrawer(): void {
  act(() => {
    root.render(
      <WorkspaceKanbanDrawer
        open={true}
        statusBarVisible={true}
        dragPreview={false}
        preserveOpenForMenu={false}
        onOpenChange={vi.fn()}
        onMenuOpenChange={vi.fn()}
      />
    )
  })
}

function describeLane(status: string): string[] {
  return (gridState.current?.laneViews.get(status)?.items ?? []).map((item) => {
    if (item.type === 'project-header') {
      return `${item.label} (${item.count})`
    }
    return item.type === 'task'
      ? `${item.key}: ${item.worktrees.map((member) => member.id).join(', ')}`
      : item.worktree.id
  })
}

// Why status only: a manual-order drop may also re-rank neighbours, which is not a move.
function movedStatuses(): Map<string, string> {
  const payload = updateWorktreesMeta.mock.calls.at(-1)?.[0]
  const moved = new Map<string, string>()
  if (Array.isArray(payload)) {
    for (const entry of payload) {
      if (entry.updates.workspaceStatus !== undefined) {
        moved.set(entry.worktreeId, entry.updates.workspaceStatus)
      }
    }
  }
  return moved
}

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  gridState.current = null
  pointerDragState.current = null
  hiddenIds.clear()
  hiddenIds.add(admin.id)
  updateWorktreesMeta = vi.fn<UpdateWorktreesMeta>(() => Promise.resolve())
  useAppStore.setState({
    projectGroups: [group('work', 0), group('home', 1)],
    activeSidebarSpaceGroupId: 'work',
    repos: [
      repo('api', 'work'),
      repo('web', 'work'),
      repo('admin', 'work'),
      repo('personal', 'home')
    ],
    folderWorkspaces: [],
    worktreesByRepo: {
      api: [api, loose],
      web: [web, primary],
      admin: [admin],
      personal: [otherSpace]
    },
    groupBy: 'task',
    activeWorktreeId: null,
    workspaceStatuses: statuses,
    syncTaskStatusFromWorkspaceBoard: false,
    setSyncTaskStatusFromWorkspaceBoard: vi.fn(),
    workspaceBoardColumnWidth: 308,
    sidebarOpen: true,
    sidebarWidth: 280,
    sortBy: 'manual',
    updateWorktreeMeta: vi.fn(),
    updateWorktreesMeta,
    getKnownWorktreeById: (id: string) => allWorktrees.find((item) => item.id === id),
    recordFeatureInteraction: vi.fn()
  })
})

afterEach(() => {
  act(() => {
    root.unmount()
  })
  container.remove()
})

describe('WorkspaceKanbanDrawer task cards', () => {
  it('shows one task card in the least advanced lane, listing its board members', () => {
    renderDrawer()

    expect(describeLane('todo')).toEqual([`task:AX-3447: ${api.id}, ${web.id}`, loose.id])
    expect(describeLane('in-progress')).toEqual([])
    // Why: lane badges count cards, and a task card is one.
    expect(gridState.current?.laneViews.get('todo')?.totalCount).toBe(2)
    expect(gridState.current?.laneFullWorktreeIds.get('todo')).toEqual([api.id, web.id, loose.id])
  })

  it('drags every worktree of the task in the space, hidden ones too, never primaries', () => {
    renderDrawer()

    act(() => {
      pointerDragState.current?.onDropWorktreesInStatus({
        worktreeIds: [api.id],
        status: 'done',
        dropIndex: 0
      })
    })

    const moved = movedStatuses()
    expect(moved.get(api.id)).toBe('done')
    expect(moved.get(web.id)).toBe('done')
    expect(moved.get(admin.id)).toBe('done')
    expect(moved.has(primary.id)).toBe(false)
    expect(moved.has(otherSpace.id)).toBe(false)
    expect(moved.has(loose.id)).toBe(false)
  })

  it('moves every worktree of the task from Move to Status', () => {
    renderDrawer()

    act(() => {
      gridState.current?.onAssignWorkspaceStatus?.([api.id], 'done')
    })

    expect([...movedStatuses().keys()].sort()).toEqual([admin.id, api.id, web.id].sort())
  })

  it('moves a mixed selection: the task in full plus the plain card', () => {
    renderDrawer()

    act(() => {
      pointerDragState.current?.onDropWorktreesInStatus({
        worktreeIds: [api.id, web.id, loose.id],
        status: 'done',
        dropIndex: 0
      })
    })

    expect([...movedStatuses().keys()].sort()).toEqual([admin.id, api.id, loose.id, web.id].sort())
  })

  it('selects a task card as its board members and reports the card selected to drags', () => {
    renderDrawer()

    act(() => {
      gridState.current?.onSelectionGesture(
        { metaKey: false, ctrlKey: false, shiftKey: false } as React.MouseEvent<HTMLElement>,
        'task:AX-3447'
      )
    })

    expect(gridState.current?.selectedWorktreeIds).toEqual(
      new Set([getWorktreeHostIdentity(api), getWorktreeHostIdentity(web)])
    )
    expect(pointerDragState.current?.selectedWorktreeIds.has('task:AX-3447')).toBe(true)
  })

  it('keeps one card per worktree when the space is not grouped by task', () => {
    useAppStore.setState({ groupBy: 'none' })
    renderDrawer()

    expect(describeLane('todo')).toEqual([api.id, loose.id])
    expect(describeLane('in-progress')).toEqual([web.id])

    act(() => {
      pointerDragState.current?.onDropWorktreesInStatus({
        worktreeIds: [api.id],
        status: 'done',
        dropIndex: 0
      })
    })

    expect([...movedStatuses().keys()]).toEqual([api.id])
  })
})
