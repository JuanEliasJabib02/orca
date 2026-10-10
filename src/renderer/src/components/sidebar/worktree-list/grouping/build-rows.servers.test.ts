import { describe, expect, it } from 'vitest'
import { buildRows } from './build-rows'
import { ALL_GROUP_KEY, PINNED_GROUP_KEY } from './group-keys'
import type { GroupHeaderRow, PinnedWorktreeDisplayPolicy, Row, WorktreeGroupBy } from './row-types'
import { SERVERS_LANE_KEY, isServerRootWorktree } from './server-root-lane'
import { NO_TASK_LANE_KEY } from './worktree-task-key'
import { getGroupKeysForWorktree } from './worktree-group-keys'
import { buildWorktreeTaskKeys } from './worktree-task-keys'
import { computeVisibleWorktrees } from '../../visible-worktrees'
import { repo, worktree } from '../../worktree-list-groups-test-fixtures'
import { LOCAL_EXECUTION_HOST_ID } from '../../../../../../shared/execution-host'
import type { FolderWorkspace } from '../../../../../../shared/folder-workspace-types'
import type { ProjectGroup } from '../../../../../../shared/project-group-types'
import type { Repo } from '../../../../../../shared/repo-types'
import type { Worktree } from '../../../../../../shared/worktree/types'

const BACKEND: Repo = { ...repo, id: 'backend', displayName: 'backend', path: '/tmp/backend' }
const ADMIN: Repo = { ...repo, id: 'admin', displayName: 'admin', path: '/tmp/admin' }
const NOTES: Repo = {
  ...repo,
  id: 'notes',
  displayName: 'notes',
  path: '/tmp/notes',
  kind: 'folder'
}
const REPO_MAP = new Map([BACKEND, ADMIN, NOTES].map((entry) => [entry.id, entry]))

const GROUP: ProjectGroup = {
  id: 'group-1',
  name: 'Scratch',
  parentPath: '/tmp/scratch',
  parentGroupId: null,
  createdFrom: 'folder-scan',
  tabOrder: 0,
  isCollapsed: false,
  color: null,
  createdAt: 1,
  updatedAt: 1
}

function makeWorktree(id: string, repoId: string, overrides: Partial<Worktree> = {}): Worktree {
  return { ...worktree, id, repoId, path: `/tmp/${id}`, displayName: id, ...overrides }
}

function makeRoot(id: string, repoId: string, overrides: Partial<Worktree> = {}): Worktree {
  return makeWorktree(id, repoId, { isMainWorktree: true, branch: 'refs/heads/main', ...overrides })
}

const backendRoot = makeRoot('be-root', BACKEND.id, { lastActivityAt: 50 })
const adminRoot = makeRoot('ad-root', ADMIN.id, { branch: '', lastActivityAt: 10 })
const notesRoot = makeRoot('notes-root', NOTES.id, { branch: '' })
const backendTask = makeWorktree('be-task', BACKEND.id, { branch: 'refs/heads/juan/AX-1-login' })
const adminTask = makeWorktree('ad-task', ADMIN.id, { branch: 'refs/heads/sidebar' })

const scratch: FolderWorkspace = {
  id: 'fw-1',
  projectGroupId: GROUP.id,
  name: 'Scratch notes',
  folderPath: '/tmp/scratch',
  linkedTask: null,
  comment: '',
  isArchived: false,
  isUnread: false,
  isPinned: false,
  sortOrder: 1,
  lastActivityAt: 1,
  createdAt: 1,
  updatedAt: 1
}

function build(
  worktrees: Worktree[],
  options: {
    groupBy?: WorktreeGroupBy
    collapsedGroups?: Set<string>
    folderWorkspaces?: FolderWorkspace[]
    pinnedDisplayPolicy?: PinnedWorktreeDisplayPolicy
  } = {}
): Row[] {
  const groupBy = options.groupBy ?? 'task'
  return buildRows(
    groupBy,
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
    options.folderWorkspaces ?? [],
    undefined,
    undefined,
    options.pinnedDisplayPolicy
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

describe('Group by → Task: the Servers section', () => {
  it('lists every git project root last, and nothing else', () => {
    const rows = build([backendTask, backendRoot, adminTask, adminRoot])

    expect(headers(rows).map((row) => row.key)).toEqual([
      'task:AX-1',
      'task:sidebar',
      SERVERS_LANE_KEY
    ])
    expect(itemIdsUnder(rows, SERVERS_LANE_KEY)).toEqual(['be-root', 'ad-root'])
    expect(rows.at(-1)).toMatchObject({ type: 'item', sectionKey: SERVERS_LANE_KEY })
  })

  it('heads the section "Servers", with no task to act on but the roots for agent status', () => {
    const header = headers(build([backendRoot, adminRoot])).find(
      (row) => row.key === SERVERS_LANE_KEY
    )

    expect(header).toMatchObject({ label: 'Servers', count: 2 })
    expect(header?.task).toEqual({
      taskKey: null,
      title: null,
      worktrees: [
        { worktreeId: 'be-root', repoId: 'backend' },
        { worktreeId: 'ad-root', repoId: 'admin' }
      ],
      folderWorkspaceIds: []
    })
  })

  it('shows No task only for leftovers, right before Servers', () => {
    const unnamed = makeWorktree('be-unnamed', BACKEND.id, { branch: '', displayName: '' })

    expect(headers(build([backendTask, backendRoot])).map((row) => row.key)).not.toContain(
      NO_TASK_LANE_KEY
    )
    const rows = build([backendTask, backendRoot, unnamed, notesRoot], {
      folderWorkspaces: [scratch]
    })
    expect(headers(rows).map((row) => row.key)).toEqual([
      'task:AX-1',
      NO_TASK_LANE_KEY,
      SERVERS_LANE_KEY
    ])
    // Why notes-root stays out: a folder project has no server to reach.
    expect(itemIdsUnder(rows, NO_TASK_LANE_KEY)).toEqual(['be-unnamed', 'notes-root'])
    expect(rows.filter((row) => row.type === 'folder-workspace')).toHaveLength(1)
    expect(itemIdsUnder(rows, SERVERS_LANE_KEY)).toEqual(['be-root'])
  })

  it('collapses like any other section', () => {
    const rows = build([backendTask, backendRoot], {
      collapsedGroups: new Set([SERVERS_LANE_KEY])
    })

    expect(headers(rows).find((row) => row.key === SERVERS_LANE_KEY)).toMatchObject({ count: 1 })
    expect(itemIdsUnder(rows, SERVERS_LANE_KEY)).toEqual([])
  })

  it('follows the pinned policy: a pinned root shows once unless pins are duplicated', () => {
    const pinnedRoot = { ...backendRoot, isPinned: true }

    const single = build([pinnedRoot, adminRoot])
    expect(itemIdsUnder(single, PINNED_GROUP_KEY)).toEqual(['be-root'])
    expect(itemIdsUnder(single, SERVERS_LANE_KEY)).toEqual(['ad-root'])

    const duplicated = build([pinnedRoot, adminRoot], {
      pinnedDisplayPolicy: 'duplicate-in-groups'
    })
    expect(itemIdsUnder(duplicated, SERVERS_LANE_KEY)).toEqual(['be-root', 'ad-root'])
  })

  it('reveals a root through Servers and a folder project root through No task', () => {
    const taskKeys = buildWorktreeTaskKeys([backendRoot, notesRoot])
    const keysFor = (entry: Worktree): string[] =>
      getGroupKeysForWorktree(
        'task',
        entry,
        REPO_MAP,
        null,
        undefined,
        undefined,
        [],
        undefined,
        taskKeys
      )

    expect(keysFor(backendRoot)).toEqual([SERVERS_LANE_KEY])
    expect(keysFor(notesRoot)).toEqual([NO_TASK_LANE_KEY])
  })

  it('leaves every other Group by as it was', () => {
    const all = [backendTask, backendRoot]
    for (const groupBy of ['none', 'workspace-status', 'pr-status', 'repo'] as const) {
      const rows = build(all, { groupBy })
      expect(headers(rows).map((row) => row.key)).not.toContain(SERVERS_LANE_KEY)
      expect(rows.filter((row) => row.type === 'item')).toHaveLength(2)
    }
    expect(itemIdsUnder(build(all, { groupBy: 'none' }), ALL_GROUP_KEY)).toEqual([
      'be-task',
      'be-root'
    ])
  })
})

describe('isServerRootWorktree', () => {
  it('is the main checkout of a git project, live', () => {
    expect(isServerRootWorktree(backendRoot, BACKEND)).toBe(true)
    expect(isServerRootWorktree(backendTask, BACKEND)).toBe(false)
    expect(isServerRootWorktree(notesRoot, NOTES)).toBe(false)
    expect(isServerRootWorktree({ ...backendRoot, isArchived: true }, BACKEND)).toBe(false)
    expect(isServerRootWorktree(backendRoot, undefined)).toBe(false)
  })

  it('leaves a provisioned ephemeral VM root out, as it is the recipe-created workspace', () => {
    const provisioned = { ...backendRoot, ephemeralVmCheckoutMode: 'provisioned-root' as const }

    expect(isServerRootWorktree(provisioned, BACKEND)).toBe(false)
    expect(itemIdsUnder(build([backendTask, provisioned]), SERVERS_LANE_KEY)).toEqual([])
  })
})

describe('Servers end to end, from the store filters to the rows', () => {
  it('lists every root of the space even when the filters hide them all', () => {
    const other: Repo = { ...repo, id: 'other', displayName: 'other', projectGroupId: 'home' }
    const otherRoot = makeRoot('other-root', other.id)
    const repoMap = new Map<string, Repo>([...REPO_MAP, [other.id, other]])
    const visible = computeVisibleWorktrees(
      {
        backend: [backendRoot, backendTask],
        admin: [adminRoot, adminTask],
        notes: [notesRoot],
        other: [otherRoot]
      },
      [],
      {
        filterRepoIds: ['admin'],
        spaceScope: {
          groupIds: new Set(['work']),
          repoIds: new Set(['backend', 'admin', 'notes']),
          folderWorkspaceIds: new Set()
        },
        showSleepingWorkspaces: false,
        tabsByWorktree: {},
        ptyIdsByTabId: {},
        worktreeIdsWithLiveAgent: new Set(),
        hideDefaultBranchWorkspace: true,
        hideAutomationGeneratedWorkspaces: false,
        hideCliCreatedWorkspaces: false,
        hideDetachedHeadWorkspaces: true,
        hideWorkspacesFromOtherDevices: false,
        pairedDeviceIdsByEnvironment: new Map(),
        alwaysShowDefaultBranchWorkspace: false,
        repoMap,
        workspaceHostScope: 'all',
        defaultHostId: LOCAL_EXECUTION_HOST_ID,
        worktreeLineageById: {},
        keepServerRoots: true
      }
    )
    const rows = build(visible)

    expect(itemIdsUnder(rows, SERVERS_LANE_KEY).sort()).toEqual(['ad-root', 'be-root'])
    expect(rows.some((row) => row.type === 'item' && row.worktree.id === 'other-root')).toBe(false)
    expect(rows.some((row) => row.type === 'item' && row.worktree.id === 'notes-root')).toBe(false)
  })
})
