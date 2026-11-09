// @vitest-environment happy-dom
/** Mock layout-dependent virtualization; assert only the visible card window and true lane-index attributes. */
import { cleanup, render } from '@testing-library/react'
import {
  createRef,
  useLayoutEffect,
  useState,
  type JSX,
  type ReactNode,
  type RefObject
} from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Repo } from '../../../../../../shared/repo-types'
import type { Worktree } from '../../../../../../shared/worktree/types'
import { getWorktreeHostIdentity } from '../../../../../../shared/worktree/host-qualified-identity'
import { makeWorktree } from '@/store/slices/worktrees/worktree.test-fixture'
import {
  toWorkspaceKanbanWorktreeLaneItems,
  type WorkspaceKanbanLaneItem,
  type WorkspaceKanbanTaskLaneItem
} from '../../workspace-kanban-lane-items'
import { getWorkspaceKanbanVirtualLaneItemWorktreeIds } from './workspace-kanban-virtual-lane-layout'

const WINDOW_START = 20
const WINDOW_END = 25
const virtualizerKeys = vi.hoisted(() => [] as (string | number)[])

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({
    count,
    getItemKey
  }: {
    count: number
    getItemKey: (index: number) => string | number
  }) => {
    const start = count === 0 || count <= WINDOW_END + 1 ? 0 : WINDOW_START
    const end = count === 0 ? -1 : Math.min(WINDOW_END, count - 1)
    virtualizerKeys.splice(0)
    return {
      getTotalSize: () => (count === 0 ? 0 : count * 44 - 8),
      measurementsCache: Array.from({ length: count }, (_, index) => ({
        index,
        start: index * 44,
        end: index * 44 + 36
      })),
      getVirtualItems: () =>
        Array.from({ length: Math.max(0, end - start + 1) }, (_, offset) => {
          const index = start + offset
          const key = getItemKey(index)
          virtualizerKeys.push(key)
          return { index, key, start: index * 44 }
        }),
      measureElement: () => {}
    }
  }
}))

vi.mock('../surface/WorkspaceKanbanCard', () => ({
  default: ({
    worktree,
    laneIndex,
    isActive,
    isSelected
  }: {
    worktree: Worktree
    laneIndex: number
    isActive: boolean
    isSelected: boolean
  }) => (
    <div
      data-workspace-board-card-id={getWorktreeHostIdentity(worktree)}
      data-workspace-board-worktree-id={worktree.id}
      data-workspace-board-card-index={laneIndex}
      data-active={isActive ? 'true' : 'false'}
      data-selected={isSelected ? 'true' : 'false'}
    />
  )
}))

vi.mock('../../WorkspaceKanbanTaskCard', () => ({
  default: ({
    item,
    laneIndex,
    isSelected
  }: {
    item: WorkspaceKanbanTaskLaneItem
    laneIndex: number
    isSelected: boolean
  }) => (
    <div
      data-workspace-board-card-id={item.key}
      data-workspace-board-card-index={laneIndex}
      data-task-card=""
      data-selected={isSelected ? 'true' : 'false'}
    />
  )
}))

const { default: WorkspaceKanbanLaneCardList } = await import('./WorkspaceKanbanLaneCardList')

const REPO_MAP = new Map<string, Repo>()

/** Mounts the list only once the scroll element exists, as the lane's frame-by-frame card mount does. */
function ScrollHost({
  scrollRef,
  children
}: {
  scrollRef: RefObject<HTMLDivElement | null>
  children: ReactNode
}): JSX.Element {
  const [ready, setReady] = useState(false)
  useLayoutEffect(() => setReady(true), [])
  return <div ref={scrollRef}>{ready ? children : null}</div>
}

function renderCardItems(
  items: readonly WorkspaceKanbanLaneItem[],
  options: { activeIdentity?: string; selectedIdentities?: readonly string[] } = {},
  scrollRef = createRef<HTMLDivElement>()
): HTMLElement {
  const { container } = render(
    <ScrollHost scrollRef={scrollRef}>
      <WorkspaceKanbanLaneCardList
        items={items}
        repoMap={REPO_MAP}
        activeWorktreeIdentity={options.activeIdentity ?? null}
        scrollRef={scrollRef}
        selectedWorktreeIds={new Set(options.selectedIdentities)}
        selectedWorktrees={[]}
        nativeDragEnabled={false}
        onActivate={() => {}}
        onSelectionGesture={() => false}
        onContextMenuSelect={() => []}
      />
    </ScrollHost>
  )
  return container
}

afterEach(cleanup)

describe('WorkspaceKanbanLaneCardList task cards and project headers', () => {
  it('renders a task item as one task card with its lane index and selection', () => {
    const plain = makeWorktree({ id: 'plain', repoId: 'repo', hostId: 'local' })
    const api = makeWorktree({ id: 'api', repoId: 'api', hostId: 'local' })
    const web = makeWorktree({ id: 'web', repoId: 'web', hostId: 'local' })
    const task: WorkspaceKanbanTaskLaneItem = {
      type: 'task',
      key: 'task:AX-1',
      status: 'todo',
      task: { taskKey: 'AX-1', title: null, worktrees: [], folderWorkspaceIds: [] },
      worktrees: [api, web],
      memberIds: ['api', 'web']
    }
    const scrollRef = createRef<HTMLDivElement>()
    const container = renderCardItems(
      [...toWorkspaceKanbanWorktreeLaneItems([plain]), task],
      { selectedIdentities: ['local|api', 'local|web'] },
      scrollRef
    )

    const taskCard = container.querySelector<HTMLElement>('[data-task-card]')
    expect(taskCard?.dataset.workspaceBoardCardId).toBe('task:AX-1')
    expect(taskCard?.dataset.workspaceBoardCardIndex).toBe('1')
    expect(taskCard?.dataset.selected).toBe('true')
    expect(virtualizerKeys).toEqual(['local|plain', 'task:AX-1'])
    // Why: sidebar drops convert the card index they read into worktrees through this.
    expect(getWorkspaceKanbanVirtualLaneItemWorktreeIds(scrollRef.current!)).toEqual([
      ['local|plain'],
      ['local|api', 'local|web']
    ])
  })

  it('shows a task card unselected while only some of its members are selected', () => {
    const api = makeWorktree({ id: 'api', repoId: 'api', hostId: 'local' })
    const web = makeWorktree({ id: 'web', repoId: 'web', hostId: 'local' })
    const container = renderCardItems(
      [
        {
          type: 'task',
          key: 'task:AX-1',
          status: 'todo',
          task: { taskKey: 'AX-1', title: null, worktrees: [], folderWorkspaceIds: [] },
          worktrees: [api, web],
          memberIds: ['api', 'web']
        }
      ],
      { selectedIdentities: ['local|api'] }
    )

    expect(container.querySelector<HTMLElement>('[data-task-card]')?.dataset.selected).toBe('false')
  })

  it('renders a project header between cards without a card id', () => {
    const api = makeWorktree({ id: 'api', repoId: 'api', hostId: 'local' })
    const scrollRef = createRef<HTMLDivElement>()
    const container = renderCardItems(
      [
        {
          type: 'project-header',
          key: 'project-header:todo:repo:api',
          projectKey: 'repo:api',
          label: 'api',
          count: 1
        },
        ...toWorkspaceKanbanWorktreeLaneItems([api])
      ],
      {},
      scrollRef
    )

    const header = container.querySelector<HTMLElement>('[data-workspace-board-project-header]')
    expect(header?.textContent).toContain('api')
    expect(header?.closest('[data-workspace-board-card-id]')).toBeNull()
    expect(header?.querySelector('[data-workspace-board-card-id]')).toBeNull()
    // Why: the card after a header keeps its lane index, so drop math counts the header slot.
    expect(
      container.querySelector<HTMLElement>('[data-workspace-board-card-id="local|api"]')?.dataset
        .workspaceBoardCardIndex
    ).toBe('1')
    expect(getWorkspaceKanbanVirtualLaneItemWorktreeIds(scrollRef.current!)).toEqual([
      [],
      ['local|api']
    ])
  })
})
