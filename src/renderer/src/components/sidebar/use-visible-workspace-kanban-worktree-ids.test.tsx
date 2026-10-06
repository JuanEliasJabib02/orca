// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import { useAppStore } from '@/store'
import type { ProjectGroup } from '../../../../shared/project-group-types'
import type { Tab } from '../../../../shared/tab-types'
import { getWorktreeHostIdentity } from '../../../../shared/worktree/host-qualified-identity'
import { makeRepo, makeWorktree } from '../worktree-jump-palette-test-fixtures'
import { useVisibleWorkspaceKanbanWorktreeIds } from './use-visible-workspace-kanban-worktree-ids'

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

describe('useVisibleWorkspaceKanbanWorktreeIds', () => {
  beforeEach(() => {
    useAppStore.setState(initialState, true)
  })

  afterEach(() => {
    cleanup()
    useAppStore.setState(initialState, true)
  })

  it('keeps a single-host filter host-qualified when workspace ids collide', () => {
    const local = makeWorktree('shared', 'Local workspace', { hostId: 'local' })
    const ssh = makeWorktree('shared', 'SSH workspace', { hostId: 'ssh:box' })
    const repo = makeRepo()
    useAppStore.setState({
      worktreesByRepo: { [repo.id]: [local, ssh] },
      showSleepingWorkspaces: true,
      visibleWorkspaceHostIds: ['local']
    })

    const { result } = renderHook(() =>
      useVisibleWorkspaceKanbanWorktreeIds({
        allWorktrees: [local, ssh],
        repoMap: new Map([[repo.id, repo]])
      })
    )

    expect(result.current).toEqual(new Set([getWorktreeHostIdentity(local)]))
  })

  it('keeps a structured-chat workspace visible when sleeping workspaces are hidden', () => {
    const worktree = makeWorktree('chat', 'Chat workspace')
    const repo = makeRepo()
    const structuredTab: Tab = {
      id: 'chat-tab',
      entityId: 'chat-session',
      groupId: 'chat-group',
      worktreeId: worktree.id,
      contentType: 'agent-session',
      agentSessionAgent: 'codex',
      label: 'Chat',
      customLabel: null,
      color: null,
      sortOrder: 0,
      createdAt: 0
    }
    useAppStore.setState({
      worktreesByRepo: { [repo.id]: [worktree] },
      unifiedTabsByWorktree: { [worktree.id]: [structuredTab] },
      showSleepingWorkspaces: false
    })

    const { result } = renderHook(() =>
      useVisibleWorkspaceKanbanWorktreeIds({
        allWorktrees: [worktree],
        repoMap: new Map([[repo.id, repo]])
      })
    )

    expect(result.current).toEqual(new Set([getWorktreeHostIdentity(worktree)]))
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
})
