import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ProjectGroup } from '../../../shared/project-group-types'
import type { Worktree } from '../../../shared/worktree/types'
import { useAppStore } from '@/store'
import { activateAndRevealWorktree } from './worktree-activation'

const initialAppStoreState = useAppStore.getState()

afterEach(() => {
  useAppStore.setState(initialAppStoreState, true)
})

function makeWorktree(overrides: Partial<Worktree>): Worktree {
  return {
    id: 'repo-1::/workspace/repo',
    repoId: 'repo-1',
    path: '/workspace/repo',
    head: 'abc123',
    branch: 'refs/heads/main',
    isBare: false,
    isMainWorktree: false,
    displayName: 'repo',
    comment: '',
    linkedIssue: null,
    linkedPR: null,
    linkedLinearIssue: null,
    isArchived: false,
    isUnread: false,
    isPinned: false,
    sortOrder: 0,
    lastActivityAt: 0,
    ...overrides
  }
}

// Why every provenance and a detached HEAD: each hide filter needs something of the root to hide.
const HIDDEN_ROOT = makeWorktree({
  isMainWorktree: true,
  branch: '',
  automationProvenance: {
    kind: 'created-by-automation',
    automationId: 'automation-1',
    automationNameSnapshot: 'Nightly review',
    automationRunId: 'run-1',
    automationRunTitleSnapshot: 'Nightly review run',
    createdAt: 123,
    executionTargetType: 'local',
    executionTargetId: 'local',
    projectId: 'repo-1',
    repoId: 'repo-1',
    hostId: 'local'
  },
  cliProvenance: { kind: 'created-by-cli', createdAt: 0 }
})
const HIDDEN_FEATURE = makeWorktree({
  id: 'repo-1::/workspace/feature',
  path: '/workspace/feature',
  branch: '',
  displayName: 'feature',
  cliProvenance: { kind: 'created-by-cli', createdAt: 0 }
})

function seedFilteredSidebar(
  worktree: Worktree,
  groupBy: 'task' | 'repo'
): ReturnType<typeof vi.fn> {
  const revealWorktreeInSidebar = vi.fn()
  useAppStore.setState({
    groupBy,
    repos: [
      {
        id: 'repo-1',
        path: '/workspace/repo',
        displayName: 'repo',
        badgeColor: '#000000',
        addedAt: 0
      }
    ],
    worktreesByRepo: { 'repo-1': [worktree] },
    activeRepoId: 'repo-1',
    activeView: 'terminal',
    activeWorktreeId: worktree.id,
    activeTabId: 'tab-1',
    activeTabType: 'terminal',
    tabsByWorktree: { [worktree.id]: [] },
    ptyIdsByTabId: {},
    everActivatedWorktreeIds: new Set([worktree.id]),
    filterRepoIds: ['repo-2'],
    hideAutomationGeneratedWorkspaces: true,
    hideCliCreatedWorkspaces: true,
    hideDetachedHeadWorkspaces: true,
    markWorktreeVisited: vi.fn(),
    recordWorktreeVisit: vi.fn(),
    refreshGitHubForWorktreeIfStale: vi.fn(),
    revealWorktreeInSidebar
  })
  return revealWorktreeInSidebar
}

describe('activateAndRevealWorktree for a Servers root', () => {
  it('keeps every sidebar filter when Group by is Task', () => {
    const revealWorktreeInSidebar = seedFilteredSidebar(HIDDEN_ROOT, 'task')

    activateAndRevealWorktree(HIDDEN_ROOT.id)

    const state = useAppStore.getState()
    expect(state.filterRepoIds).toEqual(['repo-2'])
    expect(state.hideAutomationGeneratedWorkspaces).toBe(true)
    expect(state.hideCliCreatedWorkspaces).toBe(true)
    expect(state.hideDetachedHeadWorkspaces).toBe(true)
    expect(revealWorktreeInSidebar).toHaveBeenCalledWith(HIDDEN_ROOT.id)
  })

  it('still lifts the filters hiding it under another Group by', () => {
    seedFilteredSidebar(HIDDEN_ROOT, 'repo')

    activateAndRevealWorktree(HIDDEN_ROOT.id)

    const state = useAppStore.getState()
    expect(state.filterRepoIds).toEqual(['repo-2', 'repo-1'])
    expect(state.hideAutomationGeneratedWorkspaces).toBe(false)
    expect(state.hideCliCreatedWorkspaces).toBe(false)
    expect(state.hideDetachedHeadWorkspaces).toBe(false)
  })

  it('still lifts the filters hiding a regular worktree in Group by Task', () => {
    seedFilteredSidebar(HIDDEN_FEATURE, 'task')

    activateAndRevealWorktree(HIDDEN_FEATURE.id)

    const state = useAppStore.getState()
    expect(state.filterRepoIds).toEqual(['repo-2', 'repo-1'])
    expect(state.hideCliCreatedWorkspaces).toBe(false)
    expect(state.hideDetachedHeadWorkspaces).toBe(false)
  })
})

function makeSpace(id: string, tabOrder: number): ProjectGroup {
  return {
    id,
    name: id,
    parentPath: null,
    parentGroupId: null,
    createdFrom: 'manual',
    tabOrder,
    isCollapsed: false,
    color: null,
    createdAt: 0,
    updatedAt: 0
  }
}

// Why: the root's project lives in space-b while space-a is active, so the reveal switches spaces.
function seedCrossSpace(activeGroupBy: 'task' | 'repo', rootSpaceGroupBy: 'task' | 'repo'): void {
  seedFilteredSidebar(HIDDEN_ROOT, activeGroupBy)
  const [repo] = useAppStore.getState().repos
  useAppStore.setState({
    repos: [
      { ...repo, projectGroupId: 'space-b' },
      { ...repo, id: 'repo-2', path: '/workspace/other', projectGroupId: 'space-a' }
    ],
    projectGroups: [makeSpace('space-a', 0), makeSpace('space-b', 1)],
    activeSidebarSpaceGroupId: 'space-a',
    groupByBySpaceId: { 'space-a': activeGroupBy, 'space-b': rootSpaceGroupBy }
  })
}

describe('activateAndRevealWorktree for a root in another space', () => {
  it('keeps the filters when the root lands under Servers in its own space', () => {
    seedCrossSpace('repo', 'task')

    activateAndRevealWorktree(HIDDEN_ROOT.id)

    const state = useAppStore.getState()
    expect(state.filterRepoIds).toEqual(['repo-2'])
    expect(state.hideCliCreatedWorkspaces).toBe(true)
    expect(state.hideDetachedHeadWorkspaces).toBe(true)
  })

  it('lifts the filters when its own space does not group by Task', () => {
    seedCrossSpace('task', 'repo')

    activateAndRevealWorktree(HIDDEN_ROOT.id)

    const state = useAppStore.getState()
    expect(state.hideCliCreatedWorkspaces).toBe(false)
    expect(state.hideDetachedHeadWorkspaces).toBe(false)
  })
})
