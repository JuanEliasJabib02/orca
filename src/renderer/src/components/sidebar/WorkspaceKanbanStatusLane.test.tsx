// @vitest-environment happy-dom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Repo } from '../../../../shared/repo-types'
import type { Worktree } from '../../../../shared/worktree/types'
import {
  toWorkspaceKanbanWorktreeLaneItems,
  type WorkspaceKanbanLaneItem
} from './workspace-kanban-lane-items'
import WorkspaceKanbanStatusLane from './workspace-board/viewport/WorkspaceKanbanStatusLane'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('./workspace-board/viewport/WorkspaceKanbanLaneCardList', () => ({
  default: ({ items }: { items: readonly WorkspaceKanbanLaneItem[] }) => (
    <div>
      {items.map((item) => (
        <div key={item.key} data-workspace-board-card-id={item.key} />
      ))}
    </div>
  )
}))

vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipContent: () => null
}))

const status = { id: 'todo', label: 'Todo' }
const repoMap = new Map<string, Repo>()

function worktree(id: string): Worktree {
  return { id, repoId: 'repo-a', displayName: id } as Worktree
}

let container: HTMLDivElement
let root: Root

function renderLane(props: {
  items: WorkspaceKanbanLaneItem[]
  totalCount: number
  hasQuery: boolean
}): void {
  act(() => {
    root.render(
      <WorkspaceKanbanStatusLane
        status={status}
        items={props.items}
        totalCount={props.totalCount}
        hasQuery={props.hasQuery}
        repoMap={repoMap}
        activeWorktreeIdentity={null}
        columnWidth={308}
        isResizingColumn={false}
        isDragTarget={false}
        renderCards={true}
        selectedWorktreeIds={new Set()}
        selectedWorktrees={[]}
        onDragOver={vi.fn()}
        onDragLeave={vi.fn()}
        onDrop={vi.fn()}
        onActivate={vi.fn()}
        onSelectionGesture={vi.fn(() => false)}
        onContextMenuSelect={vi.fn(() => [])}
        onCreateWorktree={vi.fn()}
        onColumnResizeStart={vi.fn()}
        onColumnResizeKeyDown={vi.fn()}
      />
    )
  })
}

beforeEach(() => {
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

describe('WorkspaceKanbanStatusLane', () => {
  it('leaves project headers out of the card count', () => {
    const header: WorkspaceKanbanLaneItem = {
      type: 'project-header',
      key: 'project-header:todo:repo:a',
      projectKey: 'repo:a',
      label: 'a',
      count: 2
    }
    renderLane({
      items: [header, ...toWorkspaceKanbanWorktreeLaneItems([worktree('a'), worktree('b')])],
      totalCount: 4,
      hasQuery: true
    })

    expect(container.textContent).toContain('2 / 4')
  })
})
