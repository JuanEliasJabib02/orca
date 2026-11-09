import { afterEach, describe, expect, it } from 'vitest'
import { useAppStore } from '@/store/index'
import {
  getVisibleWorktreeIds,
  setVisibleWorktreeIds,
  setVisibleWorktreeShortcutTargets
} from './visible-worktrees'
import type { AppState } from '@/store/types'
import type { FolderWorkspace } from '../../../../../../shared/folder-workspaces/folder-workspace-types'
import type { ProjectGroup } from '../../../../../../shared/project-group-types'
import type { Repo } from '../../../../../../shared/repo-types'
import type { Worktree } from '../../../../../../shared/worktree/types'

// Orca Pro Max: closed-sidebar Cmd+1-9 order under Group by → Task and inside a sidebar space,
// both fork-only, so these cases live apart from upstream's suite.

const initialState = useAppStore.getInitialState()

function makeWorktree(id: string, overrides: Partial<Worktree> = {}): Worktree {
  return {
    id,
    repoId: 'repo1',
    path: `/tmp/${id}`,
    head: 'abc123',
    branch: 'refs/heads/feature',
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
    lastActivityAt: 0,
    ...overrides
  } as Worktree
}

function makeMainWorktree(id: string, overrides: Partial<Worktree> = {}): Worktree {
  return makeWorktree(id, { isMainWorktree: true, branch: 'refs/heads/main', ...overrides })
}

function makeRepo(id = 'repo1', overrides: Partial<Repo> = {}): Repo {
  return {
    id,
    name: id,
    path: `/tmp/${id}`,
    defaultBranch: 'main',
    connectionId: null,
    ...overrides
  } as unknown as Repo
}

function makeProjectGroup(id: string, overrides: Partial<ProjectGroup> = {}): ProjectGroup {
  return {
    id,
    name: id,
    parentPath: `/tmp/${id}`,
    connectionId: null,
    parentGroupId: null,
    createdFrom: 'folder-scan',
    tabOrder: 0,
    isCollapsed: false,
    color: null,
    createdAt: 1,
    updatedAt: 1,
    ...overrides
  } as ProjectGroup
}

function makeFolderWorkspace(id: string, projectGroupId: string): FolderWorkspace {
  return {
    id,
    projectGroupId,
    name: id,
    folderPath: `/tmp/${id}`,
    connectionId: null,
    linkedTask: null,
    comment: '',
    isArchived: false,
    isUnread: false,
    isPinned: false,
    sortOrder: 0,
    lastActivityAt: 0,
    createdAt: 1,
    updatedAt: 1
  }
}

/** Clear the published order so the closed-sidebar fallback must recompute it from store fields. */
function seedStore(worktrees: Worktree[], overrides: Partial<AppState> = {}): void {
  useAppStore.setState(
    {
      ...initialState,
      repos: [makeRepo()],
      worktreesByRepo: { repo1: worktrees },
      // Why showSleepingWorkspaces: fixtures have no PTYs, so the activity filter
      // would otherwise drop every workspace before ordering runs.
      showSleepingWorkspaces: true,
      groupBy: 'repo',
      sortBy: 'manual',
      ...overrides
    } as AppState,
    true
  )
  setVisibleWorktreeIds(null)
  setVisibleWorktreeShortcutTargets(null)
}

describe('closed-sidebar Cmd+1-9 ordering with tasks and spaces', () => {
  afterEach(() => {
    setVisibleWorktreeIds(null)
    setVisibleWorktreeShortcutTargets(null)
    useAppStore.setState(initialState, true)
  })

  it('numbers Group by → Task sections in their rendered order', () => {
    const older = makeWorktree('wt-older', { branch: 'refs/heads/ax-1', lastActivityAt: 1 })
    const newer = makeWorktree('wt-newer', { branch: 'refs/heads/feat/ax_2', lastActivityAt: 5 })
    const named = makeWorktree('wt-named', { branch: 'refs/heads/cleanup', lastActivityAt: 3 })
    const root = makeMainWorktree('wt-root', { lastActivityAt: 9 })
    seedStore([root, older, named, newer], { groupBy: 'task' })

    // Most recently active task first, a branch name counting as one; the root sits in Servers, last.
    expect(getVisibleWorktreeIds()).toEqual(['wt-newer', 'wt-named', 'wt-older', 'wt-root'])
  })

  it('numbers a project root that the filters hide but Group by → Task lists under Servers', () => {
    const feature = makeWorktree('wt-feature', { branch: 'refs/heads/ax-1' })
    const root = makeMainWorktree('wt-root')
    seedStore([root, feature], { groupBy: 'task', hideDefaultBranchWorkspace: true })

    expect(getVisibleWorktreeIds()).toEqual(['wt-feature', 'wt-root'])

    seedStore([root, feature], { groupBy: 'repo', hideDefaultBranchWorkspace: true })
    expect(getVisibleWorktreeIds()).toEqual(['wt-feature'])
  })

  it('numbers only the active space, folder workspaces included', () => {
    const work = makeProjectGroup('group-work', { tabOrder: 0 })
    const personal = makeProjectGroup('group-personal', { tabOrder: 1 })
    const workRepo = makeRepo('repo1', { projectGroupId: work.id })
    const personalRepo = makeRepo('repo-personal', { projectGroupId: personal.id })
    const storeOverrides: Partial<AppState> = {
      projectGroups: [work, personal],
      repos: [workRepo, personalRepo],
      worktreesByRepo: {
        repo1: [makeMainWorktree('wt-work')],
        'repo-personal': [makeMainWorktree('wt-personal', { repoId: 'repo-personal' })]
      },
      folderWorkspaces: [
        makeFolderWorkspace('fw-work', work.id),
        makeFolderWorkspace('fw-personal', personal.id)
      ]
    }

    seedStore([], storeOverrides)
    expect(getVisibleWorktreeIds()).toEqual(
      expect.arrayContaining(['wt-work', 'wt-personal', 'folder:fw-work', 'folder:fw-personal'])
    )

    seedStore([], { ...storeOverrides, activeSidebarSpaceGroupId: personal.id })
    expect([...getVisibleWorktreeIds()].sort()).toEqual(['folder:fw-personal', 'wt-personal'])
  })
})
