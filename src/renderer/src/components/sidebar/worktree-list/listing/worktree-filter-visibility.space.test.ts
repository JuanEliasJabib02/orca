import { describe, expect, it, vi } from 'vitest'
import type { Worktree } from '../../../../../../shared/worktree/types'

const mocks = vi.hoisted(() => ({ getState: vi.fn() }))
vi.mock('@/store', () => ({ useAppStore: { getState: mocks.getState } }))

import { worktreePassesSidebarFilters } from './worktree-filter-visibility'

// Orca Pro Max: the active sidebar space narrows the filters, a fork-only rule, so its case lives here.

const WORKTREE_ID = 'repo-1::/projects/app'

function makeWorktree(): Worktree {
  return {
    id: WORKTREE_ID,
    repoId: 'repo-1',
    path: '/projects/app',
    head: 'abc',
    branch: 'main',
    isBare: false,
    isMainWorktree: false,
    displayName: 'app',
    comment: '',
    linkedIssue: null,
    linkedPR: null,
    linkedLinearIssue: null,
    isArchived: false,
    isUnread: false,
    isPinned: false,
    sortOrder: 0,
    lastActivityAt: 1
  } as Worktree
}

function stateWithRepoIn(repoGroupId: string): unknown {
  return {
    repos: [
      {
        id: 'repo-1',
        path: '/projects/app',
        displayName: 'app',
        badgeColor: '',
        addedAt: 1,
        projectGroupId: repoGroupId
      }
    ],
    projectGroups: [
      { id: 'work', parentGroupId: null },
      { id: 'personal', parentGroupId: null }
    ],
    folderWorkspaces: [],
    activeSidebarSpaceGroupId: 'work',
    worktreesByRepo: { 'repo-1': [makeWorktree()] },
    filterRepoIds: [],
    showSleepingWorkspaces: true,
    tabsByWorktree: {},
    ptyIdsByTabId: {},
    browserTabsByWorktree: {},
    agentStatusByPaneKey: {},
    hideDefaultBranchWorkspace: false,
    hideAutomationGeneratedWorkspaces: false,
    hideCliCreatedWorkspaces: false,
    hideDetachedHeadWorkspaces: false,
    hideWorkspacesFromOtherDevices: false,
    alwaysShowDefaultBranchWorkspace: true,
    workspaceHostScope: 'all',
    visibleWorkspaceHostIds: null,
    settings: null,
    worktreeLineageById: {}
  }
}

describe('worktreePassesSidebarFilters inside a space', () => {
  it('hides a workspace whose project lives outside the active sidebar space', () => {
    mocks.getState.mockReturnValue(stateWithRepoIn('personal'))
    expect(worktreePassesSidebarFilters(WORKTREE_ID)).toBe(false)

    mocks.getState.mockReturnValue(stateWithRepoIn('work'))
    expect(worktreePassesSidebarFilters(WORKTREE_ID)).toBe(true)
  })
})
