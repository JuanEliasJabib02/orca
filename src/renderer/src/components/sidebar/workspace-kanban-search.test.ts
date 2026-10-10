import { describe, expect, it } from 'vitest'
import { WORKTREE_PALETTE_QUERY_MAX_BYTES } from '@/lib/worktree-palette-query-bounds'
import type { Repo } from '../../../../shared/repo-types'
import type { Worktree } from '../../../../shared/worktree/types'
import { getWorktreeHostIdentity } from '../../../../shared/worktree/host-qualified-identity'
import {
  buildWorkspaceKanbanLaneViews,
  matchWorkspaceBoardWorktrees
} from './workspace-kanban-search'
import {
  getLaneItemWorktreeIds,
  toWorkspaceKanbanWorktreeLaneItem,
  toWorkspaceKanbanWorktreeLaneItems,
  type WorkspaceKanbanLaneItem,
  type WorkspaceKanbanProjectHeaderLaneItem,
  type WorkspaceKanbanTaskLaneItem
} from './workspace-kanban-lane-items'

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

const repoMap = new Map<string, Repo>([
  ['repo-a', { id: 'repo-a', displayName: 'orca' } as Repo],
  ['repo-b', { id: 'repo-b', displayName: 'atlas' } as Repo]
])

function match(worktrees: Worktree[], query: string): ReadonlySet<string> | null {
  return matchWorkspaceBoardWorktrees({ worktrees, query, repoMap })
}

function identities(...worktrees: Worktree[]): Set<string> {
  return new Set(worktrees.map(getWorktreeHostIdentity))
}

describe('matchWorkspaceBoardWorktrees', () => {
  it('treats blank and whitespace-only queries as no filtering', () => {
    const worktrees = [worktree({ id: 'a' })]
    expect(match(worktrees, '')).toBeNull()
    expect(match(worktrees, '   ')).toBeNull()
  })

  it('matches display name, branch, and repo display name', () => {
    const worktrees = [
      worktree({ id: 'name', displayName: 'Search field' }),
      worktree({ id: 'branch', displayName: 'Other', branch: 'refs/heads/feat/search-lane' }),
      worktree({ id: 'repo', displayName: 'Other', repoId: 'repo-b' }),
      worktree({ id: 'miss', displayName: 'Other' })
    ]

    expect(match(worktrees, 'search')).toEqual(identities(worktrees[0]!, worktrees[1]!))
    expect(match(worktrees, 'atlas')).toEqual(identities(worktrees[2]!))
  })

  it('matches the workspace comment', () => {
    const worktrees = [
      worktree({ id: 'commented', displayName: 'Other', comment: 'blocked on review' }),
      worktree({ id: 'miss', displayName: 'Other' })
    ]

    expect(match(worktrees, 'blocked')).toEqual(identities(worktrees[0]!))
  })

  it('excludes worktrees that only match on PR, issue, or port', () => {
    const worktrees = [
      worktree({ id: 'pr', displayName: 'Other', linkedPR: 4242 }),
      worktree({ id: 'issue', displayName: 'Other', linkedIssue: 4242 })
    ]

    expect(match(worktrees, '4242')).toEqual(new Set())
  })

  it('matches composite repo/branch queries', () => {
    const worktrees = [
      worktree({ id: 'hit', displayName: 'Other', branch: 'main' }),
      worktree({ id: 'wrong-repo', displayName: 'Other', repoId: 'repo-b', branch: 'main' })
    ]

    expect(match(worktrees, 'orca/main')).toEqual(identities(worktrees[0]!))
  })

  it('is case-insensitive', () => {
    const worktrees = [worktree({ id: 'a', displayName: 'Search Field' })]

    expect(match(worktrees, 'SEARCH')).toEqual(identities(worktrees[0]!))
  })

  it('treats regex metacharacters as literal text', () => {
    // Why: matching is indexOf, never RegExp. This pins that, so swapping in a
    // regex later fails here instead of silently changing what users can search.
    const worktrees = [
      worktree({ id: 'literal', displayName: 'feat.*fix' }),
      worktree({ id: 'would-match-as-regex', displayName: 'featANYfix' })
    ]

    expect(match(worktrees, 'feat.*fix')).toEqual(identities(worktrees[0]!))
    expect(match(worktrees, '(')).toEqual(new Set())
  })

  it('matches non-ASCII display names and comments', () => {
    const worktrees = [
      worktree({ id: 'cjk', displayName: '検索フィールド' }),
      worktree({ id: 'accent', displayName: 'Other', comment: 'Añadir búsqueda' }),
      worktree({ id: 'miss', displayName: 'Other' })
    ]

    expect(match(worktrees, 'フィールド')).toEqual(identities(worktrees[0]!))
    expect(match(worktrees, 'BÚSQUEDA')).toEqual(identities(worktrees[1]!))
  })

  it('treats an over-bound query as no filtering rather than zero matches', () => {
    const worktrees = [worktree({ id: 'a', displayName: 'Search field' })]

    expect(match(worktrees, 'x'.repeat(WORKTREE_PALETTE_QUERY_MAX_BYTES + 1))).toBeNull()
  })

  // STA-4343 closed: the documents map is keyed by host identity, so two workspaces sharing
  // `repoId::path` across hosts each keep their own searchable document.
  it('separates two same-id host rows', () => {
    const local = worktree({ id: 'shared', branch: 'refs/heads/local-only' })
    const remote = worktree({
      id: local.id,
      hostId: 'ssh:box',
      branch: 'refs/heads/remote-only'
    })

    // Each row matches on its OWN branch, and neither match leaks to the other host.
    expect(match([local, remote], 'local-only')).toEqual(identities(local))
    expect(match([local, remote], 'remote-only')).toEqual(identities(remote))
    expect(match([local], 'local-only')).toEqual(identities(local))
  })
})

describe('buildWorkspaceKanbanLaneViews', () => {
  const todo = [worktree({ id: 'todo-a', displayName: 'Alpha' }), worktree({ id: 'todo-b' })]
  const doing = [worktree({ id: 'doing-a', displayName: 'Alpha' })]
  const todoItems = toWorkspaceKanbanWorktreeLaneItems(todo)
  const doingItems = toWorkspaceKanbanWorktreeLaneItems(doing)
  const laneItems = new Map<string, WorkspaceKanbanLaneItem[]>([
    ['todo', todoItems],
    ['doing', doingItems]
  ])

  it('reuses the input arrays when no query is active', () => {
    const views = buildWorkspaceKanbanLaneViews({ laneItems, matchingWorktreeIds: null })

    expect(views.get('todo')?.items).toBe(todoItems)
    expect(views.get('doing')?.items).toBe(doingItems)
    expect(views.get('todo')?.totalCount).toBe(2)
  })

  it('preserves lane order and per-lane sort order', () => {
    const views = buildWorkspaceKanbanLaneViews({
      laneItems,
      matchingWorktreeIds: identities(...todo, ...doing)
    })

    expect(Array.from(views.keys())).toEqual(['todo', 'doing'])
    expect(getLaneItemWorktreeIds(views.get('todo')?.items ?? [])).toEqual(['todo-a', 'todo-b'])
  })

  it('keeps a fully filtered lane with an empty item list and its real total', () => {
    const views = buildWorkspaceKanbanLaneViews({
      laneItems,
      matchingWorktreeIds: identities(doing[0]!)
    })

    expect(views.get('todo')).toEqual({ items: [], totalCount: 2 })
    expect(getLaneItemWorktreeIds(views.get('doing')?.items ?? [])).toEqual(['doing-a'])
  })
})

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
