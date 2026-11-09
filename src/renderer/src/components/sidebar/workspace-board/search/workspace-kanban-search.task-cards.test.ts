import { describe, expect, it } from 'vitest'
import type { Worktree } from '../../../../../../shared/worktree/types'
import { getWorktreeHostIdentity } from '../../../../../../shared/worktree/host-qualified-identity'
import { buildWorkspaceKanbanLaneViews } from './workspace-kanban-search'
import {
  getLaneItemWorktreeIds,
  toWorkspaceKanbanWorktreeLaneItem,
  toWorkspaceKanbanWorktreeLaneItems,
  type WorkspaceKanbanLaneItem,
  type WorkspaceKanbanProjectHeaderLaneItem,
  type WorkspaceKanbanTaskLaneItem
} from '../../workspace-kanban-lane-items'

function worktree(overrides: Partial<Worktree> & { id: string }): Worktree {
  return {
    repoId: 'repo-a',
    displayName: 'Workspace',
    path: `/${overrides.id}`,
    branch: 'main',
    baseBranch: 'main',
    isPinned: false,
    sortOrder: 1,
    hostId: 'local',
    ...overrides
  } as Worktree
}

function identities(...worktrees: Worktree[]): Set<string> {
  return new Set(worktrees.map(getWorktreeHostIdentity))
}

describe('buildWorkspaceKanbanLaneViews with task cards', () => {
  const api = worktree({ id: 'api', displayName: 'Backend' })
  const web = worktree({ id: 'web', displayName: 'Storefront' })
  const loose = worktree({ id: 'loose', displayName: 'Cleanup' })
  const card: WorkspaceKanbanTaskLaneItem = {
    type: 'task',
    key: 'task:AX-3447',
    status: 'todo',
    task: {
      taskKey: 'AX-3447',
      title: 'Checkout flow',
      worktrees: [
        { worktreeId: 'api', repoId: 'repo-a' },
        { worktreeId: 'web', repoId: 'repo-a' }
      ],
      folderWorkspaceIds: []
    },
    worktrees: [api, web],
    memberIds: ['api', 'web']
  }
  const laneItems = new Map<string, WorkspaceKanbanLaneItem[]>([
    ['todo', [card, toWorkspaceKanbanWorktreeLaneItem(loose)]]
  ])

  it('shows the whole task card, as one card, when any member matches', () => {
    const views = buildWorkspaceKanbanLaneViews({
      laneItems,
      matchingWorktreeIds: identities(web),
      query: 'storefront'
    })

    expect(views.get('todo')?.items).toEqual([card])
    expect(views.get('todo')?.totalCount).toBe(2)
  })

  it('shows a task card whose key or title holds the query', () => {
    for (const query of ['ax-3447', '3447', 'checkout']) {
      const views = buildWorkspaceKanbanLaneViews({
        laneItems,
        matchingWorktreeIds: new Set(),
        query
      })
      expect(views.get('todo')?.items).toEqual([card])
    }
  })

  it('hides a task card when neither a member nor its key matches', () => {
    const views = buildWorkspaceKanbanLaneViews({
      laneItems,
      matchingWorktreeIds: identities(loose),
      query: 'cleanup'
    })

    expect(getLaneItemWorktreeIds(views.get('todo')?.items ?? [])).toEqual(['loose'])
    expect(views.get('todo')?.totalCount).toBe(2)
  })
})

describe('buildWorkspaceKanbanLaneViews with project headers', () => {
  function header(projectKey: string, count: number): WorkspaceKanbanProjectHeaderLaneItem {
    return {
      type: 'project-header',
      key: `project-header:todo:${projectKey}`,
      projectKey,
      label: projectKey,
      count
    }
  }
  const apiOne = worktree({ id: 'api-one', displayName: 'Alpha' })
  const apiTwo = worktree({ id: 'api-two', displayName: 'Beta' })
  const webOne = worktree({ id: 'web-one', displayName: 'Gamma' })
  const apiHeader = header('repo:api', 2)
  const webHeader = header('repo:web', 1)
  const laneItems = new Map<string, WorkspaceKanbanLaneItem[]>([
    [
      'todo',
      [
        apiHeader,
        ...toWorkspaceKanbanWorktreeLaneItems([apiOne, apiTwo]),
        webHeader,
        toWorkspaceKanbanWorktreeLaneItem(webOne)
      ]
    ]
  ])

  it('counts cards, not headers, in the lane total', () => {
    const views = buildWorkspaceKanbanLaneViews({ laneItems, matchingWorktreeIds: null })

    expect(views.get('todo')?.totalCount).toBe(3)
  })

  it('keeps a header only over a shown card, recounted to what shows', () => {
    const views = buildWorkspaceKanbanLaneViews({
      laneItems,
      matchingWorktreeIds: identities(apiTwo)
    })

    expect(views.get('todo')?.items).toEqual([
      { ...apiHeader, count: 1 },
      toWorkspaceKanbanWorktreeLaneItem(apiTwo)
    ])
    expect(views.get('todo')?.totalCount).toBe(3)
  })

  it('reuses an unchanged header when its whole section matches', () => {
    const views = buildWorkspaceKanbanLaneViews({
      laneItems,
      matchingWorktreeIds: identities(webOne)
    })

    expect(views.get('todo')?.items[0]).toBe(webHeader)
  })
})
