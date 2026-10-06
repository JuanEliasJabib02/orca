import { describe, expect, it } from 'vitest'
import { buildRows } from './build-rows'
import { PINNED_GROUP_KEY } from './group-keys'
import type { GroupHeaderRow, Row } from './row-types'
import { NO_TASK_LANE_KEY } from './worktree-task-key'
import { getGroupKeysForWorktree } from './worktree-group-keys'
import { repo, worktree } from '../../worktree-list-groups-test-fixtures'
import type { FolderWorkspace } from '../../../../../../shared/folder-workspace-types'
import type { ProjectGroup } from '../../../../../../shared/project-group-types'
import type { Repo } from '../../../../../../shared/repo-types'
import type { Worktree } from '../../../../../../shared/worktree/types'

const BACKEND: Repo = { ...repo, id: 'backend', displayName: 'backend-action' }
const ADMIN: Repo = { ...repo, id: 'admin', displayName: 'admin-action', path: '/tmp/admin' }
const REPO_MAP = new Map([
  [BACKEND.id, BACKEND],
  [ADMIN.id, ADMIN]
])

const GROUP: ProjectGroup = {
  id: 'group-1',
  name: 'Notes',
  parentPath: '/tmp/notes',
  parentGroupId: null,
  createdFrom: 'folder-scan',
  tabOrder: 0,
  isCollapsed: false,
  color: null,
  createdAt: 1,
  updatedAt: 1
}

function makeWorktree(overrides: Partial<Worktree> & Pick<Worktree, 'id'>): Worktree {
  return { ...worktree, repoId: BACKEND.id, ...overrides }
}

function makeFolderWorkspace(overrides: Partial<FolderWorkspace> = {}): FolderWorkspace {
  return {
    id: 'fw-1',
    projectGroupId: GROUP.id,
    name: 'Scratch notes',
    folderPath: '/tmp/notes',
    linkedTask: null,
    comment: '',
    isArchived: false,
    isUnread: false,
    isPinned: false,
    sortOrder: 1,
    lastActivityAt: 1,
    createdAt: 1,
    updatedAt: 1,
    ...overrides
  }
}

function buildTaskRows(
  worktrees: Worktree[],
  options: { collapsedGroups?: Set<string>; folderWorkspaces?: FolderWorkspace[] } = {}
): Row[] {
  return buildRows(
    'task',
    worktrees,
    REPO_MAP,
    null,
    options.collapsedGroups ?? new Set<string>(),
    undefined,
    undefined,
    'manual',
    {},
    new Map(worktrees.map((entry) => [entry.id, entry])),
    false,
    undefined,
    [GROUP],
    new Set(),
    new Map(),
    new Map(),
    [],
    undefined,
    options.folderWorkspaces ?? []
  )
}

function headers(rows: Row[]): GroupHeaderRow[] {
  return rows.filter((row): row is GroupHeaderRow => row.type === 'header')
}

function itemIdsUnder(rows: Row[], sectionKey: string): string[] {
  return rows.flatMap((row) =>
    row.type === 'item' && row.sectionKey === sectionKey ? [row.worktree.id] : []
  )
}

const backend3448 = makeWorktree({
  id: 'wt-backend-3448',
  branch: 'refs/heads/juan/ax-3448-login',
  lastActivityAt: 10,
  linkedWorkItem: {
    provider: 'jira',
    type: 'issue',
    number: 0,
    title: 'Login flow',
    url: 'https://example.atlassian.net/browse/AX-3448',
    jiraIdentifier: 'AX-3448'
  }
})
const admin3448 = makeWorktree({
  id: 'wt-admin-3448',
  repoId: ADMIN.id,
  branch: 'refs/heads/feat/Ax_3448',
  lastActivityAt: 5
})
const backend3356 = makeWorktree({
  id: 'wt-backend-3356',
  branch: 'refs/heads/ax-3356',
  lastActivityAt: 50
})
const backendMain = makeWorktree({
  id: 'wt-main',
  branch: 'refs/heads/main',
  displayName: 'main',
  lastActivityAt: 100
})

describe('buildRows grouped by task', () => {
  it('groups worktrees across repos by task key, most recent task first, No task last', () => {
    const rows = buildTaskRows([backend3448, admin3448, backend3356, backendMain])

    expect(headers(rows).map((row) => row.key)).toEqual([
      'task:AX-3356',
      'task:AX-3448',
      NO_TASK_LANE_KEY
    ])
    expect(itemIdsUnder(rows, 'task:AX-3448')).toEqual(['wt-backend-3448', 'wt-admin-3448'])
    expect(itemIdsUnder(rows, NO_TASK_LANE_KEY)).toEqual(['wt-main'])
  })

  it('labels a task with its Jira title when linked, the bare key otherwise', () => {
    const labels = headers(buildTaskRows([backend3448, admin3448, backend3356, backendMain])).map(
      (row) => row.label
    )

    expect(labels).toEqual(['AX-3356', 'AX-3448 · Login flow', 'No task'])
  })

  it('exposes the task members with their repos for whole-task header actions', () => {
    const header = headers(buildTaskRows([backend3448, admin3448])).find(
      (row) => row.key === 'task:AX-3448'
    )

    expect(header?.task).toEqual({
      taskKey: 'AX-3448',
      title: 'Login flow',
      worktrees: [
        { worktreeId: 'wt-backend-3448', repoId: 'backend' },
        { worktreeId: 'wt-admin-3448', repoId: 'admin' }
      ],
      folderWorkspaceIds: []
    })
    expect(header?.count).toBe(2)
    expect(header?.worktreeIds).toEqual(['wt-backend-3448', 'wt-admin-3448'])
  })

  it('keeps pinned members in the task info while the Pinned section holds their row', () => {
    const rows = buildTaskRows([{ ...admin3448, isPinned: true }, backend3448])
    const header = headers(rows).find((row) => row.key === 'task:AX-3448')

    expect(itemIdsUnder(rows, PINNED_GROUP_KEY)).toEqual(['wt-admin-3448'])
    expect(header?.count).toBe(1)
    expect(header?.task?.worktrees.map((entry) => entry.worktreeId)).toEqual([
      'wt-admin-3448',
      'wt-backend-3448'
    ])
  })

  it('hides the rows of a collapsed task but keeps its header', () => {
    const rows = buildTaskRows([backend3448, admin3448, backendMain], {
      collapsedGroups: new Set(['task:AX-3448'])
    })

    expect(headers(rows).map((row) => row.key)).toContain('task:AX-3448')
    expect(itemIdsUnder(rows, 'task:AX-3448')).toEqual([])
    expect(itemIdsUnder(rows, NO_TASK_LANE_KEY)).toEqual(['wt-main'])
  })

  it('files folder workspaces by their name, since they have no branch', () => {
    const rows = buildTaskRows([backend3448], {
      folderWorkspaces: [
        makeFolderWorkspace({ id: 'fw-task', name: 'ax 3448 notes', lastActivityAt: 1 }),
        makeFolderWorkspace({ id: 'fw-none', name: 'Scratch', lastActivityAt: 1 })
      ]
    })
    const folderSections: [string, string | null][] = []
    let sectionKey: string | null = null
    for (const row of rows) {
      if (row.type === 'header') {
        sectionKey = row.key
      } else if (row.type === 'folder-workspace') {
        folderSections.push([row.folderWorkspace.id, sectionKey])
      }
    }

    expect(folderSections).toEqual([
      ['fw-task', 'task:AX-3448'],
      ['fw-none', NO_TASK_LANE_KEY]
    ])
    expect(headers(rows).find((row) => row.key === 'task:AX-3448')?.task).toMatchObject({
      folderWorkspaceIds: ['fw-task']
    })
  })

  it('reveals a worktree through its task section key', () => {
    expect(getGroupKeysForWorktree('task', admin3448, REPO_MAP, null)).toEqual(['task:AX-3448'])
  })
})
