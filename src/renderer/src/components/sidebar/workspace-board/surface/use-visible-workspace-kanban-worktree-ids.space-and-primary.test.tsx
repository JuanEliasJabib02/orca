// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import { useAppStore } from '@/store'
import type { ProjectGroup } from '../../../../../../shared/project-group-types'
import { DEFAULT_WORKSPACE_STATUSES } from '../../../../../../shared/workspace-status-defaults'
import { getWorktreeHostIdentity } from '../../../../../../shared/worktree/host-qualified-identity'
import { makeRepo, makeWorktree } from '../../../worktree-jump/worktree-jump-palette-test-fixtures'
import { useVisibleWorkspaceKanbanWorktreeIds } from './use-visible-workspace-kanban-worktree-ids'
import { buildWorkspaceKanbanLaneViews } from '../search/workspace-kanban-search'
import {
  buildWorkspaceKanbanLaneItems,
  getLaneItemWorktreeIds
} from '../../workspace-kanban-lane-items'
import { groupWorkspaceKanbanWorktrees } from '../projection/workspace-kanban-worktree-groups'
import { buildVisibleWorktreeOptionsFromState } from '../../worktree-list/listing/visible-worktree-options-from-state'
import { computeVisibleWorktrees } from '../../worktree-list/listing/compute-visible-worktrees'

const initialState = useAppStore.getInitialState()

function makeGroup(id: string): ProjectGroup {
  return {
    id,
    name: id,
    parentPath: null,
    parentGroupId: null,
    createdFrom: 'manual',
    tabOrder: 0,
    isCollapsed: false,
    color: null,
    createdAt: 0,
    updatedAt: 0
  }
}

describe('useVisibleWorkspaceKanbanWorktreeIds spaces and primary worktrees', () => {
  beforeEach(() => {
    useAppStore.setState(initialState, true)
  })

  afterEach(() => {
    cleanup()
    useAppStore.setState(initialState, true)
  })

  it('limits the board to the active sidebar space', () => {
    const inSpace = makeWorktree('in-space', 'In space')
    const outOfSpace = makeWorktree('out-of-space', 'Out of space', { repoId: 'repo-2' })
    const repo = makeRepo()
    const otherRepo = { ...makeRepo(), id: 'repo-2', projectGroupId: 'personal' }
    useAppStore.setState({
      worktreesByRepo: { [repo.id]: [inSpace], [otherRepo.id]: [outOfSpace] },
      showSleepingWorkspaces: true,
      repos: [{ ...repo, projectGroupId: 'work' }, otherRepo],
      projectGroups: [makeGroup('work'), makeGroup('personal')],
      activeSidebarSpaceGroupId: 'work'
    })

    const { result } = renderHook(() =>
      useVisibleWorkspaceKanbanWorktreeIds({
        allWorktrees: [inSpace, outOfSpace],
        repoMap: new Map([
          [repo.id, repo],
          [otherRepo.id, otherRepo]
        ])
      })
    )

    expect(result.current).toEqual(new Set([getWorktreeHostIdentity(inSpace)]))

    act(() => useAppStore.setState({ activeSidebarSpaceGroupId: null }))

    expect(result.current).toEqual(
      new Set([getWorktreeHostIdentity(inSpace), getWorktreeHostIdentity(outOfSpace)])
    )
  })
  describe('primary worktrees', () => {
    const repo = makeRepo()
    const otherRepo = { ...makeRepo(), id: 'repo-2' }
    const fullRepoMap = new Map([
      [repo.id, repo],
      [otherRepo.id, otherRepo]
    ])
    const primaryOnMain = makeWorktree('primary-main', 'main', {
      isMainWorktree: true,
      branch: 'refs/heads/main',
      workspaceStatus: 'todo'
    })
    const primaryOnStaging = makeWorktree('primary-staging', 'staging', {
      repoId: 'repo-2',
      isMainWorktree: true,
      branch: 'refs/heads/staging',
      workspaceStatus: 'in-progress'
    })
    const task = makeWorktree('task', 'Task', { workspaceStatus: 'todo' })
    const otherTask = makeWorktree('other-task', 'Other task', {
      repoId: 'repo-2',
      workspaceStatus: 'in-progress'
    })
    const allWorktrees = [primaryOnMain, primaryOnStaging, task, otherTask]

    function seedStore(overrides: Partial<ReturnType<typeof useAppStore.getState>> = {}): void {
      useAppStore.setState({
        worktreesByRepo: {
          [repo.id]: [primaryOnMain, task],
          [otherRepo.id]: [primaryOnStaging, otherTask]
        },
        showSleepingWorkspaces: true,
        ...overrides
      })
    }

    function renderBoardIds(worktrees = allWorktrees): ReadonlySet<string> {
      return renderHook(() =>
        useVisibleWorkspaceKanbanWorktreeIds({ allWorktrees: worktrees, repoMap: fullRepoMap })
      ).result.current
    }

    it('leaves out the primary on main and on another branch such as staging', () => {
      seedStore()

      expect(renderBoardIds()).toEqual(
        new Set([getWorktreeHostIdentity(task), getWorktreeHostIdentity(otherTask)])
      )
    })

    it('leaves out an idle primary while sleeping workspaces are hidden, with or without the sweep exemption', () => {
      for (const alwaysShowDefaultBranchWorkspace of [true, false]) {
        seedStore({ showSleepingWorkspaces: false, alwaysShowDefaultBranchWorkspace })
        const ids = renderBoardIds()

        expect(ids.has(getWorktreeHostIdentity(primaryOnMain))).toBe(false)
        expect(ids.has(getWorktreeHostIdentity(primaryOnStaging))).toBe(false)
      }
    })

    it('leaves out a primary even when the default-branch filters would show it', () => {
      seedStore({ hideDefaultBranchWorkspace: false, alwaysShowDefaultBranchWorkspace: true })

      expect(renderBoardIds().has(getWorktreeHostIdentity(primaryOnMain))).toBe(false)
    })

    it('leaves out a folder project root and keeps its other workspaces', () => {
      const folderRepo = { ...makeRepo(), id: 'folder', kind: 'folder' as const }
      const root = makeWorktree('folder::/notes', 'notes', {
        repoId: folderRepo.id,
        isMainWorktree: true,
        head: '',
        branch: ''
      })
      const instance = makeWorktree('folder::/notes::workspace:1', 'notes 1', {
        repoId: folderRepo.id,
        head: '',
        branch: ''
      })
      useAppStore.setState({
        worktreesByRepo: { [folderRepo.id]: [root, instance] },
        showSleepingWorkspaces: true
      })

      const { result } = renderHook(() =>
        useVisibleWorkspaceKanbanWorktreeIds({
          allWorktrees: [root, instance],
          repoMap: new Map([[folderRepo.id, folderRepo]])
        })
      )

      expect(result.current).toEqual(new Set([getWorktreeHostIdentity(instance)]))
    })

    it('keeps a provisioned-root checkout: it is the recipe-created workspace, not a source-repo row', () => {
      const provisionedRoot = makeWorktree('vm-root', 'vm', {
        isMainWorktree: true,
        ephemeralVmCheckoutMode: 'provisioned-root'
      })
      useAppStore.setState({
        worktreesByRepo: { [repo.id]: [provisionedRoot, primaryOnMain] },
        showSleepingWorkspaces: true
      })

      const { result } = renderHook(() =>
        useVisibleWorkspaceKanbanWorktreeIds({
          allWorktrees: [provisionedRoot, primaryOnMain],
          repoMap: fullRepoMap
        })
      )

      expect(result.current).toEqual(new Set([getWorktreeHostIdentity(provisionedRoot)]))
    })

    it('counts lanes and the board total without primaries', () => {
      seedStore()
      const visibleWorktreeIds = renderBoardIds()

      const grouped = groupWorkspaceKanbanWorktrees({
        worktrees: allWorktrees,
        visibleWorktreeIds,
        workspaceStatuses: DEFAULT_WORKSPACE_STATUSES,
        sortBy: 'recent'
      })
      const laneViews = buildWorkspaceKanbanLaneViews({
        laneItems: buildWorkspaceKanbanLaneItems({
          worktreesByStatus: grouped,
          workspaceStatuses: DEFAULT_WORKSPACE_STATUSES,
          taskGrouping: null
        }),
        matchingWorktreeIds: null
      })

      expect(laneViews.get('todo')?.totalCount).toBe(1)
      expect(laneViews.get('in-progress')?.totalCount).toBe(1)
      expect(getLaneItemWorktreeIds(laneViews.get('todo')?.items ?? [])).toEqual(['task'])
      expect(getLaneItemWorktreeIds(laneViews.get('in-progress')?.items ?? [])).toEqual([
        'other-task'
      ])
      const boardTotal = [...grouped.values()].reduce((sum, items) => sum + items.length, 0)
      expect(boardTotal).toBe(visibleWorktreeIds.size)
    })

    it('does not change the sidebar list, which still shows primaries', () => {
      seedStore()
      const state = useAppStore.getState()
      const sidebarIds = computeVisibleWorktrees(
        state.worktreesByRepo,
        allWorktrees.map((worktree) => worktree.id),
        buildVisibleWorktreeOptionsFromState(state, fullRepoMap)
      ).map((worktree) => worktree.id)

      expect(new Set(sidebarIds)).toEqual(new Set(allWorktrees.map((worktree) => worktree.id)))
    })
  })

  it('ignores a project filter picked in another space', () => {
    const inSpace = makeWorktree('in-space', 'In space')
    const outOfSpace = makeWorktree('out-of-space', 'Out of space', { repoId: 'repo-2' })
    const repo = makeRepo()
    const otherRepo = { ...makeRepo(), id: 'repo-2', projectGroupId: 'personal' }
    useAppStore.setState({
      worktreesByRepo: { [repo.id]: [inSpace], [otherRepo.id]: [outOfSpace] },
      showSleepingWorkspaces: true,
      repos: [{ ...repo, projectGroupId: 'work' }, otherRepo],
      projectGroups: [makeGroup('work'), makeGroup('personal')],
      activeSidebarSpaceGroupId: 'work',
      filterRepoIds: [otherRepo.id]
    })

    const { result } = renderHook(() =>
      useVisibleWorkspaceKanbanWorktreeIds({
        allWorktrees: [inSpace, outOfSpace],
        repoMap: new Map([
          [repo.id, repo],
          [otherRepo.id, otherRepo]
        ])
      })
    )

    expect(result.current).toEqual(new Set([getWorktreeHostIdentity(inSpace)]))

    act(() => useAppStore.setState({ activeSidebarSpaceGroupId: 'personal' }))

    expect(result.current).toEqual(new Set([getWorktreeHostIdentity(outOfSpace)]))
  })
})
