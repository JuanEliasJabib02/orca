import { describe, expect, it } from 'vitest'
import type { FolderWorkspace } from '../../../../shared/folder-workspace-types'
import type { ProjectGroup } from '../../../../shared/project-group-types'
import type { Repo } from '../../../../shared/repo-types'
import {
  filterFolderWorkspacesToSidebarSpace,
  filterProjectGroupsToSidebarSpace,
  isWorktreeInSidebarSpace,
  listSidebarSpaces,
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
    expect(scope?.repoIds).toEqual(new Set(['repo-work', 'repo-client', 'repo-legacy']))
    expect(scope?.folderWorkspaceIds).toEqual(new Set(['folder-work']))
  })

  it('resolves to All when the active group is nested under another group', () => {
    expect(resolve('work-client')).toBeNull()
  })

  it('excludes ungrouped projects and projects in other spaces', () => {
    const scope = resolve('personal')

    expect(scope?.repoIds).toEqual(new Set(['repo-personal']))
    expect(scope?.folderWorkspaceIds).toEqual(new Set(['folder-personal']))
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
    ).toEqual(new Set(['repo-personal']))
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
    expect(isWorktreeInSidebarSpace({ id: 'wt-3', repoId: 'repo-ungrouped' }, scope)).toBe(false)
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
