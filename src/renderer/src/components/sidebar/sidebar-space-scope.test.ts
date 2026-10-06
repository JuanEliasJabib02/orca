import { describe, expect, it } from 'vitest'
import { LOCAL_EXECUTION_HOST_ID } from '../../../../shared/execution-host'
import type { FolderWorkspace } from '../../../../shared/folder-workspace-types'
import type { ProjectGroup } from '../../../../shared/project-group-types'
import type { Repo } from '../../../../shared/repo-types'
import {
  filterFolderWorkspacesToSidebarSpace,
  filterProjectGroupsToSidebarSpace,
  findSidebarSpaceToReveal,
  isWorktreeInSidebarSpace,
  isSpacelessRepo,
  listSidebarSpaces,
  listSpacelessRepoIdsOnHost,
  resolveActiveSidebarSpaceId,
  resolveSidebarSpaceScope,
  resolveSidebarSpaceScopeFromState
} from './sidebar-space-scope'

function makeGroup(id: string, parentGroupId: string | null = null, tabOrder = 0): ProjectGroup {
  return {
    id,
    name: id,
    parentPath: null,
    parentGroupId,
    createdFrom: 'manual',
    tabOrder,
    isCollapsed: false,
    color: null,
    createdAt: 0,
    updatedAt: 0
  }
}

function makeRepo(id: string, projectGroupId: string | null = null): Repo {
  return { id, path: `/${id}`, displayName: id, badgeColor: '#000', addedAt: 0, projectGroupId }
}

function makeFolderWorkspace(id: string, projectGroupId: string): FolderWorkspace {
  return {
    id,
    projectGroupId,
    name: id,
    folderPath: `/${id}`,
    linkedTask: null,
    comment: '',
    isArchived: false,
    isUnread: false,
    isPinned: false,
    sortOrder: 0,
    lastActivityAt: 0,
    createdAt: 0,
    updatedAt: 0
  }
}

const groups = [
  makeGroup('work'),
  makeGroup('work-client', 'work'),
  makeGroup('work-client-legacy', 'work-client'),
  makeGroup('personal')
]
const repos = [
  makeRepo('repo-work', 'work'),
  makeRepo('repo-client', 'work-client'),
  makeRepo('repo-legacy', 'work-client-legacy'),
  makeRepo('repo-personal', 'personal'),
  makeRepo('repo-ungrouped')
]
const folderWorkspaces = [
  makeFolderWorkspace('folder-work', 'work-client'),
  makeFolderWorkspace('folder-personal', 'personal')
]

function resolve(activeGroupId: string | null, overrides: { projectGroups?: ProjectGroup[] } = {}) {
  return resolveSidebarSpaceScope({
    activeGroupId,
    projectGroups: overrides.projectGroups ?? groups,
    repos,
    folderWorkspaces
  })
}

describe('resolveSidebarSpaceScope', () => {
  it('resolves to All when no space is active', () => {
    expect(resolve(null)).toBeNull()
  })

  it('resolves to All when the active group no longer exists', () => {
    expect(resolve('deleted-group')).toBeNull()
  })

  it('includes the group, its descendants, and the projects filed under any of them', () => {
    const scope = resolve('work')

    expect(scope?.groupIds).toEqual(new Set(['work', 'work-client', 'work-client-legacy']))
    expect(scope?.repoIds).toEqual(
      new Set(['repo-work', 'repo-client', 'repo-legacy', 'repo-ungrouped'])
    )
    expect(scope?.folderWorkspaceIds).toEqual(new Set(['folder-work']))
  })

  it('resolves to All when the active group is nested under another group', () => {
    expect(resolve('work-client')).toBeNull()
  })

  it('excludes projects in other spaces but keeps spaceless ones in every space', () => {
    const scope = resolve('personal')

    expect(scope?.repoIds).toEqual(new Set(['repo-personal', 'repo-ungrouped']))
    expect(scope?.folderWorkspaceIds).toEqual(new Set(['folder-personal']))
  })

  it('treats a repo whose group was deleted as spaceless, so every space shows it', () => {
    const scope = resolveSidebarSpaceScope({
      activeGroupId: 'personal',
      projectGroups: groups,
      repos: [makeRepo('repo-orphan', 'deleted-group'), makeRepo('repo-work', 'work')],
      folderWorkspaces: []
    })

    expect(scope?.repoIds).toEqual(new Set(['repo-orphan']))
  })

  it('terminates when corrupt data makes a group its own descendant', () => {
    const corrupt = [makeGroup('a'), makeGroup('b', 'a'), makeGroup('a', 'b'), makeGroup('c')]
    const scope = resolveSidebarSpaceScope({
      activeGroupId: 'a',
      projectGroups: corrupt,
      repos: [makeRepo('repo-b', 'b'), makeRepo('repo-c', 'c')],
      folderWorkspaces: []
    })

    expect(scope?.groupIds).toEqual(new Set(['a', 'b']))
    expect(scope?.repoIds).toEqual(new Set(['repo-b']))
  })
})

describe('resolveSidebarSpaceScopeFromState', () => {
  it('resolves from the store fields and treats a missing id as All', () => {
    const state = { projectGroups: groups, repos, folderWorkspaces }

    expect(
      resolveSidebarSpaceScopeFromState({ ...state, activeSidebarSpaceGroupId: 'personal' })
        ?.repoIds
    ).toEqual(new Set(['repo-personal', 'repo-ungrouped']))
    expect(
      resolveSidebarSpaceScopeFromState({ ...state, activeSidebarSpaceGroupId: null })
    ).toBeNull()
  })
})

describe('isWorktreeInSidebarSpace', () => {
  const scope = resolve('work')!

  it('matches repo worktrees by their repo', () => {
    expect(isWorktreeInSidebarSpace({ id: 'wt-1', repoId: 'repo-client' }, scope)).toBe(true)
    expect(isWorktreeInSidebarSpace({ id: 'wt-2', repoId: 'repo-personal' }, scope)).toBe(false)
    expect(isWorktreeInSidebarSpace({ id: 'wt-3', repoId: 'repo-ungrouped' }, scope)).toBe(true)
  })

  it('matches folder workspaces by their workspace id, not the synthetic repo id', () => {
    expect(
      isWorktreeInSidebarSpace(
        { id: 'folder:folder-work', repoId: 'folder-workspace:work-client' },
        scope
      )
    ).toBe(true)
    expect(
      isWorktreeInSidebarSpace(
        { id: 'folder:folder-personal', repoId: 'folder-workspace:personal' },
        scope
      )
    ).toBe(false)
  })
})

describe('filterProjectGroupsToSidebarSpace / filterFolderWorkspacesToSidebarSpace', () => {
  it('returns the input untouched when no space is active', () => {
    expect(filterProjectGroupsToSidebarSpace(groups, null)).toBe(groups)
    expect(filterFolderWorkspacesToSidebarSpace(folderWorkspaces, null)).toBe(folderWorkspaces)
  })

  it('keeps only the active space subtree', () => {
    const scope = resolve('work')

    expect(filterProjectGroupsToSidebarSpace(groups, scope).map((group) => group.id)).toEqual([
      'work',
      'work-client',
      'work-client-legacy'
    ])
    expect(
      filterFolderWorkspacesToSidebarSpace(folderWorkspaces, scope).map((workspace) => workspace.id)
    ).toEqual(['folder-work'])
  })
})

describe('listSidebarSpaces', () => {
  it('lists top-level groups by tabOrder and leaves nested groups out', () => {
    const spaces = listSidebarSpaces([
      makeGroup('arctic', null, 2),
      makeGroup('nested', 'arctic', 0),
      makeGroup('action', null, 0),
      makeGroup('personal', null, 1)
    ])

    expect(spaces.map((group) => group.id)).toEqual(['action', 'personal', 'arctic'])
  })

  it('keeps the input order for equal tabOrder and does not mutate the input', () => {
    const input = [makeGroup('b', null, 1), makeGroup('a', null, 1), makeGroup('c', 'b', 0)]
    const snapshot = [...input]

    expect(listSidebarSpaces(input).map((group) => group.id)).toEqual(['b', 'a'])
    expect(input).toEqual(snapshot)
  })
})

describe('resolveActiveSidebarSpaceId', () => {
  const spaces = [
    makeGroup('second', null, 1),
    makeGroup('first', null, 0),
    makeGroup('child', 'first')
  ]

  it('keeps a stored id that is still a space', () => {
    expect(resolveActiveSidebarSpaceId('second', spaces)).toBe('second')
  })

  it('falls back to the first space for an unset, deleted or nested id', () => {
    expect(resolveActiveSidebarSpaceId(null, spaces)).toBe('first')
    expect(resolveActiveSidebarSpaceId('deleted', spaces)).toBe('first')
    expect(resolveActiveSidebarSpaceId('child', spaces)).toBe('first')
  })

  it('is null when there are no spaces', () => {
    expect(resolveActiveSidebarSpaceId(null, [])).toBeNull()
  })
})

describe('isSpacelessRepo', () => {
  const known = new Set(['work'])

  it('is true for an ungrouped repo or one whose group is gone', () => {
    expect(isSpacelessRepo({ projectGroupId: null }, known)).toBe(true)
    expect(isSpacelessRepo({ projectGroupId: undefined }, known)).toBe(true)
    expect(isSpacelessRepo({ projectGroupId: 'deleted' }, known)).toBe(true)
  })

  it('is false for a repo in a known group', () => {
    expect(isSpacelessRepo({ projectGroupId: 'work' }, known)).toBe(false)
  })
})

describe('listSpacelessRepoIdsOnHost', () => {
  it('lists ungrouped and orphaned repos on that host, in store order', () => {
    const repoList = [
      makeRepo('loose'),
      makeRepo('grouped', 'work'),
      { ...makeRepo('remote'), connectionId: 'devbox' },
      makeRepo('orphan', 'deleted-group')
    ]

    expect(listSpacelessRepoIdsOnHost(repoList, groups, LOCAL_EXECUTION_HOST_ID)).toEqual([
      'loose',
      'orphan'
    ])
  })
})

describe('findSidebarSpaceToReveal', () => {
  function find(worktree: { id: string; repoId: string }, activeGroupId: string | null) {
    return findSidebarSpaceToReveal(worktree, {
      activeGroupId,
      projectGroups: groups,
      repos,
      folderWorkspaces
    })
  }

  it('names the top-level space of a workspace the active space hides', () => {
    expect(find({ id: 'wt-1', repoId: 'repo-personal' }, 'work')).toBe('personal')
    expect(find({ id: 'wt-2', repoId: 'repo-legacy' }, 'personal')).toBe('work')
    expect(
      find({ id: 'folder:folder-work', repoId: 'folder-workspace:work-client' }, 'personal')
    ).toBe('work')
  })

  it('returns null when the active space already shows the workspace', () => {
    expect(find({ id: 'wt-1', repoId: 'repo-client' }, 'work')).toBeNull()
    expect(find({ id: 'wt-3', repoId: 'repo-ungrouped' }, 'personal')).toBeNull()
  })

  it('returns null when no space is active', () => {
    expect(find({ id: 'wt-1', repoId: 'repo-personal' }, null)).toBeNull()
  })
})
