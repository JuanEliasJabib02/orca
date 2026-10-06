// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, renderHook } from '@testing-library/react'
import type { FolderWorkspace } from '../../../../../../shared/folder-workspace-types'
import type { ProjectGroup } from '../../../../../../shared/project-group-types'
import type { Repo } from '../../../../../../shared/repo-types'
import { LOCAL_EXECUTION_HOST_ID } from '../../../../../../shared/execution-host'
import type { SidebarSpaceScope } from '../../sidebar-space-scope'
import type { SidebarWorktreeFilters } from './use-filters'
import { useSidebarHostVisibleScope } from './use-host-visible-scope'

function makeGroup(id: string, parentGroupId: string | null = null): ProjectGroup {
  return {
    id,
    name: id,
    parentPath: null,
    parentGroupId,
    createdFrom: 'manual',
    tabOrder: 0,
    isCollapsed: false,
    color: null,
    createdAt: 0,
    updatedAt: 0
  }
}

function makeRepo(id: string, overrides: Partial<Repo> = {}): Repo {
  return { id, path: `/${id}`, displayName: id, badgeColor: '#000', addedAt: 0, ...overrides }
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

const projectGroups = [makeGroup('work'), makeGroup('work-client', 'work'), makeGroup('personal')]
const repos = [
  makeRepo('repo-work'),
  makeRepo('repo-personal'),
  makeRepo('repo-ssh', { connectionId: 'box' })
]
const folderWorkspaces = [
  makeFolderWorkspace('fw-work', 'work-client'),
  makeFolderWorkspace('fw-personal', 'personal')
]

const spaceScope: SidebarSpaceScope = {
  groupIds: new Set(['work', 'work-client']),
  repoIds: new Set(['repo-work', 'repo-ssh']),
  folderWorkspaceIds: new Set(['fw-work'])
}

function renderScope(filterOverrides: Partial<SidebarWorktreeFilters['filterState']>) {
  const filterState: SidebarWorktreeFilters['filterState'] = {
    showSleepingWorkspaces: true,
    filterRepoIds: [],
    hideDefaultBranchWorkspace: false,
    hideAutomationGeneratedWorkspaces: false,
    hideCliCreatedWorkspaces: false,
    hideDetachedHeadWorkspaces: false,
    hideWorkspacesFromOtherDevices: false,
    alwaysShowDefaultBranchWorkspace: true,
    visibleWorkspaceHostIds: null,
    workspaceHostScope: 'all',
    spaceScope: null,
    ...filterOverrides
  }
  return renderHook(() =>
    useSidebarHostVisibleScope({
      filterState,
      defaultHostId: LOCAL_EXECUTION_HOST_ID,
      repos,
      projectGroups,
      folderWorkspaces,
      pairedDeviceIdsByEnvironment: new Map()
    })
  ).result.current
}

describe('useSidebarHostVisibleScope with a sidebar space', () => {
  afterEach(() => {
    cleanup()
  })

  it('passes everything through when no space is active', () => {
    const scope = renderScope({})

    expect(scope.visibleReposForRows).toBe(repos)
    expect(scope.visibleProjectGroupsForRows).toBe(projectGroups)
    expect(scope.visibleFolderWorkspacesForRows).toBe(folderWorkspaces)
  })

  it('narrows repos, groups and folder workspaces to the space', () => {
    const scope = renderScope({ spaceScope })

    expect(scope.visibleReposForRows.map((repo) => repo.id)).toEqual(['repo-work', 'repo-ssh'])
    expect(scope.visibleProjectGroupsForRows.map((group) => group.id)).toEqual([
      'work',
      'work-client'
    ])
    expect(scope.visibleFolderWorkspacesForRows.map((workspace) => workspace.id)).toEqual([
      'fw-work'
    ])
  })

  it('applies the host filter on top of the space', () => {
    const scope = renderScope({ spaceScope, visibleWorkspaceHostIds: ['local'] })

    expect(scope.visibleReposForRows.map((repo) => repo.id)).toEqual(['repo-work'])
  })
})
