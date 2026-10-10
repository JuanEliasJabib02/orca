// @vitest-environment happy-dom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { Repo } from '../../../../shared/repo-types'
import type { Worktree } from '../../../../shared/worktree/types'
import { makeWorktree } from '../../store/slices/store-test-helpers'
import type { WorkspaceKanbanTaskLaneItem } from './workspace-kanban-lane-items'

const { activateWorktreeFromSidebar } = vi.hoisted(() => ({
  activateWorktreeFromSidebar: vi.fn(() => Promise.resolve())
}))

vi.mock('@/lib/sidebar-worktree-activation', () => ({ activateWorktreeFromSidebar }))

// Why stubs: the header parts have their own tests; this one is about the card's own behavior.
vi.mock('./worktree-list/rows/TaskHeaderNoteSurface', () => ({
  TaskHeaderNoteSurface: ({ children }: { children: React.ReactElement }) => children
}))
vi.mock('./worktree-list/rows/TaskSectionHeader', () => ({
  TaskSectionHeader: ({ actions }: { actions?: React.ReactNode }) => (
    <span data-task-section-header="">{actions}</span>
  )
}))
vi.mock('./worktree-list/rows/TaskSpotlightButton', () => ({
  TaskSpotlightButton: () => <button type="button" data-task-spotlight-button="" />
}))
vi.mock('./worktree-list/rows/TaskHeaderMenu', () => ({
  TaskHeaderMenu: ({ children }: { children?: React.ReactNode }) => (
    <div data-task-header-menu="">{children}</div>
  )
}))
vi.mock('./WorktreeStatusMenuItems', () => ({
  WorktreeStatusMenuItems: (props: {
    contextWorkspaceStatus: string
    isMultiContext: boolean
    onAssignWorkspaceStatus: (status: string) => void
  }) => (
    <button
      type="button"
      data-move-to-done=""
      data-current-status={props.contextWorkspaceStatus}
      data-multi={props.isMultiContext ? 'true' : 'false'}
      onClick={() => props.onAssignWorkspaceStatus('done')}
    />
  )
}))
vi.mock('./WorktreeCardSpotlightControls', () => ({
  canHoldSpotlight: () => true,
  SpotlightQuickAction: () => <button type="button" data-spotlight-quick-action="" />
}))

const { default: WorkspaceKanbanTaskCard } = await import('./WorkspaceKanbanTaskCard')

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const api = makeWorktree({ id: 'api::/ax', repoId: 'api', hostId: 'local', displayName: 'ax' })
const web = makeWorktree({
  id: 'web::/ax',
  repoId: 'web',
  hostId: 'ssh:builder',
  displayName: 'ax'
})
const repoMap = new Map<string, Repo>([
  ['api', { id: 'api', displayName: 'backend-action', badgeColor: '#4f46e5' } as Repo],
  ['web', { id: 'web', displayName: 'admin-action', badgeColor: '#16a34a' } as Repo]
])
const ITEM: WorkspaceKanbanTaskLaneItem = {
  type: 'task',
  key: 'task:AX-3447',
  status: 'in-progress',
  task: {
    taskKey: 'AX-3447',
    title: 'Checkout flow',
    worktrees: [
      { worktreeId: api.id, repoId: 'api' },
      { worktreeId: web.id, repoId: 'web' }
    ],
    folderWorkspaceIds: []
  },
  worktrees: [api, web],
  memberIds: [api.id, web.id, 'reset::/hidden']
}

let container: HTMLDivElement
let root: Root

type SelectionGesture = (event: React.MouseEvent<HTMLElement>, cardId: string) => boolean
type AssignStatus = (worktreeIds: readonly string[], status: string) => void

function renderCard(props: Partial<React.ComponentProps<typeof WorkspaceKanbanTaskCard>> = {}): {
  onActivate: Mock<() => void>
  onSelectionGesture: Mock<SelectionGesture>
  onAssignWorkspaceStatus: Mock<AssignStatus>
} {
  const onActivate = vi.fn<() => void>()
  // Why shiftKey: a modifier click is selection-only, as the board's real handler reports.
  const onSelectionGesture = vi.fn<SelectionGesture>((event) => event.shiftKey)
  const onAssignWorkspaceStatus = vi.fn<AssignStatus>()
  act(() => {
    root.render(
      <WorkspaceKanbanTaskCard
        item={ITEM}
        laneIndex={3}
        repoMap={repoMap}
        activeWorktreeIdentity={null}
        isSelected={false}
        onActivate={onActivate}
        onSelectionGesture={onSelectionGesture}
        onAssignWorkspaceStatus={onAssignWorkspaceStatus}
        {...props}
      />
    )
  })
  return { onActivate, onSelectionGesture, onAssignWorkspaceStatus }
}

function card(): HTMLElement {
  const element = container.querySelector<HTMLElement>('[data-workspace-board-card-id]')
  if (!element) {
    throw new Error('card not rendered')
  }
  return element
}

function memberRow(worktreeId: string): HTMLElement {
  const element = Array.from(
    container.querySelectorAll<HTMLElement>('[data-workspace-board-task-member]')
  ).find((row) => row.dataset.workspaceBoardTaskMember === worktreeId)
  if (!element) {
    throw new Error(`no row for ${worktreeId}`)
  }
  return element
}

function click(element: HTMLElement, init: MouseEventInit = {}): void {
  act(() => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, ...init }))
  })
}

beforeEach(() => {
  activateWorktreeFromSidebar.mockClear()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => {
    root.unmount()
  })
  container.remove()
})

describe('WorkspaceKanbanTaskCard', () => {
  it('renders the task key, its title and one row per member repo', () => {
    renderCard()

    expect(card().textContent).toContain('AX-3447')
    expect(card().textContent).toContain('Checkout flow')
    expect(memberRow(api.id).textContent).toContain('backend-action')
    expect(memberRow(web.id).textContent).toContain('admin-action')
    expect(container.querySelector('[data-task-spotlight-button]')).not.toBeNull()
  })

  it('advertises the card to drag, drop and selection code', () => {
    renderCard({ isSelected: true })

    expect(card().dataset).toMatchObject({
      workspaceBoardCardId: 'task:AX-3447',
      workspaceBoardWorktreeId: api.id,
      workspaceBoardCardIndex: '3',
      workspaceBoardCardSelected: 'true',
      workspaceBoardPointerDraggable: 'true'
    })
  })

  it('opens the clicked row worktree on its own host', () => {
    const { onActivate, onSelectionGesture } = renderCard()

    click(memberRow(web.id))

    expect(onSelectionGesture).toHaveBeenCalledWith(expect.anything(), 'task:AX-3447')
    expect(activateWorktreeFromSidebar).toHaveBeenCalledWith(web.id, 'ssh:builder')
    expect(onActivate).toHaveBeenCalledTimes(1)
  })

  it('only selects on a modifier click of a row', () => {
    const { onActivate } = renderCard()

    click(memberRow(api.id), { shiftKey: true })

    expect(activateWorktreeFromSidebar).not.toHaveBeenCalled()
    expect(onActivate).not.toHaveBeenCalled()
  })

  it('opens a row from the keyboard', () => {
    const { onActivate } = renderCard()

    act(() => {
      memberRow(api.id).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })

    expect(activateWorktreeFromSidebar).toHaveBeenCalledWith(api.id, 'local')
    expect(onActivate).toHaveBeenCalledTimes(1)
  })

  it('leaves Enter and Space on the nested Spotlight button to that button', () => {
    const { onActivate } = renderCard()
    const spotlight = memberRow(api.id).querySelector<HTMLElement>('[data-spotlight-quick-action]')!

    act(() => {
      spotlight.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      spotlight.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }))
    })

    expect(activateWorktreeFromSidebar).not.toHaveBeenCalled()
    expect(onActivate).not.toHaveBeenCalled()
  })

  it('selects the card, without opening anything, from a click outside the rows', () => {
    const { onSelectionGesture } = renderCard()

    click(card())

    expect(onSelectionGesture).toHaveBeenCalledTimes(1)
    expect(onSelectionGesture).toHaveBeenCalledWith(expect.anything(), 'task:AX-3447')
    expect(activateWorktreeFromSidebar).not.toHaveBeenCalled()
  })

  it('moves every worktree of the task from Move to Status', () => {
    const { onAssignWorkspaceStatus } = renderCard()
    const move = container.querySelector<HTMLElement>('[data-move-to-done]')!

    expect(move.dataset.currentStatus).toBe('in-progress')
    click(move)

    expect(onAssignWorkspaceStatus).toHaveBeenCalledWith([api.id, web.id, 'reset::/hidden'], 'done')
  })

  it('moves the whole selection when the card is part of a wider one', () => {
    const other: Worktree = makeWorktree({ id: 'other::/x', repoId: 'other', hostId: 'local' })
    const { onAssignWorkspaceStatus } = renderCard({
      isSelected: true,
      selectedWorktrees: [api, web, other]
    })
    const move = container.querySelector<HTMLElement>('[data-move-to-done]')!

    expect(move.dataset.multi).toBe('true')
    click(move)

    expect(onAssignWorkspaceStatus).toHaveBeenCalledWith([api.id, web.id, other.id], 'done')
  })
})
