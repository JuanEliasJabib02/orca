// @vitest-environment happy-dom

import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DashboardAgentRow as DashboardAgentRowData } from '@/components/dashboard/useDashboardData'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import type { Repo } from '../../../../shared/repo-types'
import type { WorktreeCardProperty } from '../../../../shared/ui-chrome-types'
import type { Worktree } from '../../../../shared/worktree/types'
import type { WorkspacePortScanResult } from '../../../../shared/workspace-ports'

const fetchHostedReviewForBranch = vi.fn()
const fetchIssue = vi.fn()
const fetchLinearIssue = vi.fn()
const replaceWorkspacePortScans = vi.fn()
const setWorkspacePortScanRefreshing = vi.fn()
const cacheTimerMocks = vi.hoisted(() => ({
  usePromptCacheCountdownStartedAt: vi.fn()
}))

let worktreeCardProperties: WorktreeCardProperty[] = ['status', 'ports']
let settings: Partial<GlobalSettings> | null = { compactWorktreeCards: true }
let spotlightByRepo: Record<string, { holderWorktreeId: string }> = {}
let worktreesByRepo: Record<string, Worktree[]> = {}

vi.mock('@/store', () => {
  const getState = () => ({
    browserTabsByWorktree: {},
    agentActivityDisplayMode: undefined,
    createBrowserTab: vi.fn(),
    deleteStateByWorktreeId: {},
    fetchHostedReviewForBranch,
    fetchIssue,
    fetchLinearIssue,
    gitConflictOperationByWorktree: {},
    hostedReviewCache: {},
    issueCache: {},
    linearIssueCache: {},
    openModal: vi.fn(),
    openTaskPage: vi.fn(),
    projectGroups: [],
    ptyIdsByTabId: {},
    recordFeatureInteraction: vi.fn(),
    remoteBranchConflictByWorktreeId: {},
    setRemoteBrowserPageHandle: vi.fn(),
    replaceWorkspacePortScans,
    setWorkspacePortScanRefreshing,
    settings,
    sshConnectionStates: new Map(),
    sshTargetLabels: new Map(),
    spotlightByRepo,
    tabsByWorktree: {},
    updateWorktreeMeta: vi.fn(),
    workspacePortScan,
    worktreeCardProperties,
    worktreesByRepo
  })
  return {
    useAppStore: Object.assign((selector: (state: unknown) => unknown) => selector(getState()), {
      getState
    })
  }
})

vi.mock('@/components/ui/hover-card', () => ({
  HoverCard: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  HoverCardContent: ({ children }: { children: ReactNode }) => (
    <div data-hover-card-content="">{children}</div>
  ),
  HoverCardTrigger: ({ children }: { children: ReactNode }) => <>{children}</>
}))

vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>
}))

vi.mock('@/lib/sidebar-worktree-activation', () => ({
  activateWorktreeFromSidebar: vi.fn()
}))

vi.mock('./workspace-card/activity/use-worktree-activity-status', () => ({
  useWorktreeActivityStatus: () => 'active'
}))

vi.mock('./workspace-actions/sleep/use-worktree-sleep-state', () => ({
  useIsSleepingWorktree: () => false
}))

vi.mock('./workspace-card/activity/CacheTimer', () => ({
  default: () => null,
  usePromptCacheCountdownStartedAt: cacheTimerMocks.usePromptCacheCountdownStartedAt
}))

vi.mock('./workspace-card/activity/useWorktreeAgentRows', () => ({
  useWorktreeAgentRows: vi.fn(() => [] as DashboardAgentRowData[])
}))

vi.mock('./workspace-card/activity/WorktreeCardAgents', () => ({
  default: () => <div data-worktree-agents="" />
}))

vi.mock('./workspace-actions/context-menu/WorktreeContextMenu', () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
  WORKTREE_CONTEXT_MENU_SCOPE_ATTR: 'data-orca-context-menu-scope',
  WORKTREE_NATIVE_CONTEXT_MENU_ATTR: 'data-worktree-native-context-menu'
}))

let workspacePortScan: { key: string; result: WorkspacePortScanResult } | null = null

function makeRepo(): Repo {
  return { id: 'repo-1', path: '/repo', displayName: 'orca', badgeColor: '#999999', addedAt: 1 }
}

function makeWorktree(overrides: Partial<Worktree> = {}): Worktree {
  return {
    id: 'repo-1::/repo/worktrees/pr-456',
    repoId: 'repo-1',
    path: '/repo/worktrees/pr-456',
    displayName: 'Fix stale GH PR',
    branch: 'feature/local-branch',
    head: 'abc123',
    isBare: false,
    isMainWorktree: false,
    comment: '',
    linkedIssue: null,
    linkedPR: null,
    linkedLinearIssue: null,
    isArchived: false,
    isUnread: false,
    isPinned: false,
    sortOrder: 0,
    lastActivityAt: 1,
    ...overrides
  }
}

function makePortScan(worktree: Worktree): { key: string; result: WorkspacePortScanResult } {
  return {
    key: 'repo-1',
    result: {
      platform: 'darwin',
      scannedAt: 1,
      ports: [
        {
          id: '127.0.0.1:58941:1234',
          bindHost: '127.0.0.1',
          connectHost: '127.0.0.1',
          port: 58941,
          pid: 1234,
          processName: 'node',
          protocol: 'http',
          kind: 'workspace',
          owner: {
            worktreeId: worktree.id,
            repoId: worktree.repoId,
            displayName: worktree.displayName,
            path: worktree.path,
            confidence: 'cwd'
          }
        }
      ]
    }
  }
}

describe('WorktreeCard Spotlight port label', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.clearAllMocks()
    worktreeCardProperties = ['status', 'ports']
    settings = { compactWorktreeCards: true }
    spotlightByRepo = {}
    worktreesByRepo = {}
    cacheTimerMocks.usePromptCacheCountdownStartedAt.mockReturnValue(null)
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
  })

  const rootWorktree = makeWorktree({
    id: 'repo-1::/repo',
    path: '/repo',
    displayName: 'orca',
    isMainWorktree: true
  })

  function seedSpotlight(holder: Worktree, other: Worktree): void {
    // Why: the dev server runs in the root, so the scanner attributes its listener there.
    workspacePortScan = makePortScan(rootWorktree)
    spotlightByRepo = { 'repo-1': { holderWorktreeId: holder.id } }
    worktreesByRepo = { 'repo-1': [rootWorktree, holder, other] }
  }

  async function renderCard(worktree: Worktree): Promise<void> {
    const { default: WorktreeCard } = await import('./workspace-card/surface/WorktreeCard')
    act(() => {
      root.render(<WorktreeCard worktree={worktree} repo={makeRepo()} isActive={false} />)
    })
  }

  it('shows the root port on the row holding the Spotlight, even with the Ports property off', async () => {
    const holder = makeWorktree()
    worktreeCardProperties = ['status']
    seedSpotlight(holder, makeWorktree({ id: 'repo-1::/repo/worktrees/other' }))

    await renderCard(holder)

    expect(container.querySelector('[aria-label="1 live port :58941"]')?.textContent).toBe(':58941')
  })

  it('leaves the other task rows of the repo without the label', async () => {
    const other = makeWorktree({ id: 'repo-1::/repo/worktrees/other' })
    worktreeCardProperties = ['status']
    seedSpotlight(makeWorktree(), other)

    await renderCard(other)

    expect(container.querySelector('[aria-label*="live port"]')).toBeNull()
  })

  it('keeps the plug icon when the Spotlight is off', async () => {
    const holder = makeWorktree()
    seedSpotlight(holder, holder)
    spotlightByRepo = {}
    workspacePortScan = makePortScan(holder)

    await renderCard(holder)

    const trigger = container.querySelector('[aria-label="1 live port"]')
    expect(trigger?.querySelector('svg')).not.toBeNull()
    expect(trigger?.textContent).toBe('')
  })
})
