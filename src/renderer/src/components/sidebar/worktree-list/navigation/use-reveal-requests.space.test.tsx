// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConfirmationDialogProvider } from '@/components/confirmation-dialog'
import { requestScrollToCurrentWorkspaceReveal } from '@/lib/scroll-to-current-workspace-status'
import { useSidebarRevealRequests } from './use-reveal-requests'
import type { Worktree } from '../../../../../../shared/worktree/types'
import type { ProjectGroup } from '../../../../../../shared/project-group-types'
import type { Repo } from '../../../../../../shared/repo-types'

// Orca Pro Max: a reveal switches to the workspace's sidebar space, a fork-only rule, so its cases live here.

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const state = vi.hoisted(() => {
  const space: {
    pendingRevealSidebarRow: { rowKey: string } | null
    activeSidebarSpaceGroupId: string | null
    projectGroups: ProjectGroup[]
    repos: Repo[]
  } = {
    pendingRevealSidebarRow: null,
    activeSidebarSpaceGroupId: null,
    projectGroups: [],
    repos: []
  }
  return {
    setGroupBy: vi.fn(),
    revealSidebarRow: vi.fn(),
    revealWorktreeInSidebar: vi.fn(),
    setContextualToursBlockingSurfaceVisible: vi.fn(),
    setActiveSidebarSpaceGroupId: vi.fn(),
    ...space
  }
})
vi.mock('@/store', () => ({
  useAppStore: Object.assign((selector: (value: typeof state) => unknown) => selector(state), {
    getState: () => state
  })
}))

type Args = Parameters<typeof useSidebarRevealRequests>[0]
function Host({ args }: { args: Args }): null {
  useSidebarRevealRequests(args)
  return null
}

let root: Root
let container: HTMLDivElement
let args: Args

async function render(): Promise<void> {
  await act(async () => {
    root.render(
      <ConfirmationDialogProvider>
        <Host args={args} />
      </ConfirmationDialogProvider>
    )
  })
}

function makeSpace(id: string): ProjectGroup {
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

beforeEach(() => {
  vi.clearAllMocks()
  state.pendingRevealSidebarRow = null
  state.activeSidebarSpaceGroupId = 'work'
  state.projectGroups = [makeSpace('work'), makeSpace('personal')]
  state.repos = [
    {
      id: 'repo-1',
      path: '/repo',
      displayName: 'repo',
      badgeColor: '#000000',
      addedAt: 0,
      projectGroupId: 'personal'
    }
  ]
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  const worktree: Worktree = {
    id: 'wt-1',
    hostId: 'ssh:dev',
    repoId: 'repo-1',
    path: '/repo/feature',
    displayName: 'Feature',
    branch: 'feature',
    head: 'abc123',
    isBare: false,
    isMainWorktree: false,
    comment: '',
    linkedIssue: null,
    linkedPR: null,
    linkedLinearIssue: null,
    linkedGitLabMR: null,
    linkedGitLabIssue: null,
    isArchived: false,
    isUnread: false,
    isPinned: false,
    sortOrder: 1,
    lastActivityAt: 1
  }
  args = {
    groupBy: 'repo',
    renderedSidebarRowKeys: new Set(),
    visibleWorktrees: [],
    visibleFolderWorkspaces: [],
    currentSidebarWorktreeId: worktree.id,
    currentSidebarExecutionHostId: 'ssh:dev',
    worktreeMap: new Map([[worktree.id, worktree]]),
    worktrees: [worktree],
    folderWorkspaces: [],
    hasFilters: true,
    revealWorkspaceFilters: vi.fn()
  }
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})

describe('revealing a workspace that lives in another space', () => {
  it('switches to its space when a jump asks to reveal it, without touching filters', async () => {
    state.pendingRevealSidebarRow = { rowKey: 'wt-1' }
    await render()

    expect(state.setActiveSidebarSpaceGroupId).toHaveBeenCalledWith('personal')
    expect(args.revealWorkspaceFilters).not.toHaveBeenCalled()
  })

  it('keeps the reveal button inside the current space', async () => {
    await render()
    await act(async () => requestScrollToCurrentWorkspaceReveal())

    expect(state.setActiveSidebarSpaceGroupId).not.toHaveBeenCalled()
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(args.revealWorkspaceFilters).not.toHaveBeenCalled()
    expect(state.revealWorktreeInSidebar).not.toHaveBeenCalled()
  })

  it('stays in the current space when that space already holds the workspace', async () => {
    state.activeSidebarSpaceGroupId = 'personal'
    await render()
    await act(async () => requestScrollToCurrentWorkspaceReveal())

    expect(state.setActiveSidebarSpaceGroupId).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain(
      'Revealing it will adjust only the filters hiding it.'
    )
  })
})
