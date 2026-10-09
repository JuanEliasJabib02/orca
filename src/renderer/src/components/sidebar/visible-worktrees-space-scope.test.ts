import { describe, expect, it } from 'vitest'
import {
  computeClearFilterActions,
  computeVisibleWorktreeIds,
  sidebarHasActiveFilters
} from './visible-worktrees'
import type { SidebarSpaceScope } from './sidebar-space-scope'
import type { Repo } from '../../../../shared/repo-types'
import type { Worktree } from '../../../../shared/worktree/types'
import { LOCAL_EXECUTION_HOST_ID } from '../../../../shared/execution-host'

function makeWorktree(id: string, repoId: string): Worktree {
  return {
    id,
    repoId,
    path: `/tmp/${id}`,
    head: 'abc123',
    branch: 'refs/heads/main',
    isBare: false,
    isMainWorktree: false,
    displayName: id,
    comment: '',
    linkedIssue: null,
    linkedPR: null,
    linkedLinearIssue: null,
    isArchived: false,
    isUnread: false,
    isPinned: false,
    sortOrder: 0,
    lastActivityAt: 0
  }
}

function makeRepo(id: string): Repo {
  return { id, path: `/${id}`, displayName: id, badgeColor: '#000', addedAt: 0 }
}

const repoMap = new Map<string, Repo>([
  ['in-space', makeRepo('in-space')],
  ['other-space', makeRepo('other-space')]
])

const spaceScope: SidebarSpaceScope = {
  groupIds: new Set(['work']),
  repoIds: new Set(['in-space']),
  folderWorkspaceIds: new Set(['folder-in'])
}

type VisibleOptions = Parameters<typeof computeVisibleWorktreeIds>[2]

function visibleOptions(overrides: Partial<VisibleOptions> = {}): VisibleOptions {
  return {
    filterRepoIds: [],
    showSleepingWorkspaces: true,
    tabsByWorktree: {},
    ptyIdsByTabId: {},
    browserTabsByWorktree: {},
    worktreeIdsWithLiveAgent: new Set(),
    hideDefaultBranchWorkspace: false,
    hideAutomationGeneratedWorkspaces: false,
    hideCliCreatedWorkspaces: false,
    hideDetachedHeadWorkspaces: false,
    hideWorkspacesFromOtherDevices: false,
    pairedDeviceIdsByEnvironment: new Map(),
    repoMap,
    workspaceHostScope: 'all',
    defaultHostId: LOCAL_EXECUTION_HOST_ID,
    worktreeLineageById: {},
    ...overrides
  }
}

const inSpace = makeWorktree('in-1', 'in-space')
const outOfSpace = makeWorktree('out-1', 'other-space')
const folderIn = makeWorktree('folder:folder-in', 'folder-workspace:work')
const folderOut = makeWorktree('folder:folder-out', 'folder-workspace:personal')
const worktreesByRepo = {
  'in-space': [inSpace],
  'other-space': [outOfSpace],
  'folder-workspace:work': [folderIn],
  'folder-workspace:personal': [folderOut]
}
const sortedIds = [inSpace.id, outOfSpace.id, folderIn.id, folderOut.id]

describe('computeVisibleWorktreeIds with a sidebar space', () => {
  it('shows every workspace when no space is active', () => {
    expect(computeVisibleWorktreeIds(worktreesByRepo, sortedIds, visibleOptions())).toEqual(
      sortedIds
    )
    expect(
      computeVisibleWorktreeIds(worktreesByRepo, sortedIds, visibleOptions({ spaceScope: null }))
    ).toEqual(sortedIds)
  })

  it('keeps repo and folder workspaces inside the space and drops the rest', () => {
    const result = computeVisibleWorktreeIds(
      worktreesByRepo,
      sortedIds,
      visibleOptions({ spaceScope })
    )

    expect(result).toEqual([inSpace.id, folderIn.id])
  })

  it('keeps filtering by a project filter that names a project inside the space', () => {
    const secondInSpace = makeWorktree('in-2', 'in-space-2')
    const scope: SidebarSpaceScope = {
      ...spaceScope,
      repoIds: new Set(['in-space', 'in-space-2'])
    }

    const result = computeVisibleWorktreeIds(
      { ...worktreesByRepo, 'in-space-2': [secondInSpace] },
      [...sortedIds, secondInSpace.id],
      visibleOptions({ spaceScope: scope, filterRepoIds: ['in-space-2'] })
    )

    expect(result).toEqual([secondInSpace.id])
  })

  it('ignores a project filter that only names projects of another space', () => {
    const result = computeVisibleWorktreeIds(
      worktreesByRepo,
      sortedIds,
      visibleOptions({ spaceScope, filterRepoIds: ['other-space'] })
    )

    expect(result).toEqual([inSpace.id, folderIn.id])
  })

  it('still applies the whole project filter when no space is active', () => {
    const result = computeVisibleWorktreeIds(
      worktreesByRepo,
      sortedIds,
      visibleOptions({ filterRepoIds: ['other-space'] })
    )

    expect(result).toEqual([outOfSpace.id])
  })

  it('lets a forced worktree outside the space bypass it', () => {
    const result = computeVisibleWorktreeIds(
      worktreesByRepo,
      sortedIds,
      visibleOptions({ spaceScope, forcedVisibleWorktreeIds: [outOfSpace.id] })
    )

    expect(result).toEqual([inSpace.id, outOfSpace.id, folderIn.id])
  })
})

describe('sidebar space is not a filter', () => {
  // Why a variable: it mirrors useSidebarWorktreeFilters, which hands the whole filterState (spaceScope included) to these.
  const filterState = {
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
    spaceScope
  } as const

  it('is not counted as an active filter', () => {
    expect(sidebarHasActiveFilters(filterState)).toBe(false)
  })

  it('is never reset by Clear Filters', () => {
    const actions = computeClearFilterActions(filterState)

    expect(Object.values(actions).every((reset) => reset === false)).toBe(true)
  })
})

describe('project filter picked in another space', () => {
  const base = {
    showSleepingWorkspaces: true,
    hideDefaultBranchWorkspace: false,
    hideAutomationGeneratedWorkspaces: false,
    hideCliCreatedWorkspaces: false,
    hideDetachedHeadWorkspaces: false,
    hideWorkspacesFromOtherDevices: false,
    alwaysShowDefaultBranchWorkspace: true,
    visibleWorkspaceHostIds: null,
    workspaceHostScope: 'all'
  } as const

  it('is not an active filter in this space and is not reset by Clear Filters', () => {
    const state = { ...base, filterRepoIds: ['other-space'], spaceScope }

    expect(sidebarHasActiveFilters(state)).toBe(false)
    expect(computeClearFilterActions(state).resetFilterRepoIds).toBe(false)
  })

  it('is active again once the space is left', () => {
    const state = { ...base, filterRepoIds: ['other-space'], spaceScope: null }

    expect(sidebarHasActiveFilters(state)).toBe(true)
    expect(computeClearFilterActions(state).resetFilterRepoIds).toBe(true)
  })

  it('counts as active when one of its ids belongs to this space', () => {
    const state = { ...base, filterRepoIds: ['other-space', 'in-space'], spaceScope }

    expect(sidebarHasActiveFilters(state)).toBe(true)
    expect(computeClearFilterActions(state).resetFilterRepoIds).toBe(true)
  })
})
