// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, renderHook } from '@testing-library/react'
import { useAppStore } from '@/store'
import { LOCAL_EXECUTION_HOST_ID } from '../../../../../../shared/execution-host'
import { makeRepo, makeWorktree } from '../../../worktree-jump/worktree-jump-palette-test-fixtures'
import { useVisibleSidebarWorktrees } from './use-visible-worktrees'
import type { SidebarWorktreeFilters } from './use-filters'

// Orca Pro Max: the active sidebar space narrows the visible set, a fork-only rule, so its case lives here.

const initialState = useAppStore.getInitialState()

describe('useVisibleSidebarWorktrees inside a space', () => {
  beforeEach(() => {
    useAppStore.setState(initialState, true)
  })

  afterEach(() => {
    cleanup()
    useAppStore.setState(initialState, true)
  })

  it('narrows the visible set to the active sidebar space and refreshes when it changes', () => {
    const inSpace = makeWorktree('in-space', 'In space')
    const outOfSpace = makeWorktree('out-of-space', 'Out of space', { repoId: 'repo-2' })
    const repo = makeRepo()
    useAppStore.setState({
      worktreesByRepo: { [repo.id]: [inSpace], 'repo-2': [outOfSpace] }
    })
    const filterState = (spaceRepoIds: string[] | null): SidebarWorktreeFilters['filterState'] => ({
      showSleepingWorkspaces: true,
      filterRepoIds: [],
      spaceScope: spaceRepoIds && {
        groupIds: new Set(['group-1']),
        repoIds: new Set(spaceRepoIds),
        folderWorkspaceIds: new Set()
      },
      hideDefaultBranchWorkspace: false,
      hideAutomationGeneratedWorkspaces: false,
      hideCliCreatedWorkspaces: false,
      hideDetachedHeadWorkspaces: false,
      hideWorkspacesFromOtherDevices: false,
      alwaysShowDefaultBranchWorkspace: true,
      visibleWorkspaceHostIds: null,
      workspaceHostScope: 'all'
    })
    const argsFor = (
      state: SidebarWorktreeFilters['filterState']
    ): Parameters<typeof useVisibleSidebarWorktrees>[0] => ({
      filterState: state,
      sortBy: 'recent',
      sortedIds: [inSpace.id, outOfSpace.id],
      repoMap: new Map([[repo.id, repo]]),
      worktreeLineageById: {},
      defaultHostId: LOCAL_EXECUTION_HOST_ID,
      agentSendTargetWorktreeId: null
    })

    const { result, rerender } = renderHook(
      (state: SidebarWorktreeFilters['filterState']) => useVisibleSidebarWorktrees(argsFor(state)),
      { initialProps: filterState([repo.id]) }
    )
    expect(result.current.visibleWorktrees.map((worktree) => worktree.id)).toEqual([inSpace.id])

    rerender(filterState(null))
    expect(result.current.visibleWorktrees.map((worktree) => worktree.id)).toEqual([
      inSpace.id,
      outOfSpace.id
    ])
  })
})
