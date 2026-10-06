import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { folderWorkspaceToWorktree } from '../../../../shared/folder-workspace-worktree'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import type { Repo } from '../../../../shared/repo-types'
import type { WorktreeCardProperty } from '../../../../shared/ui-chrome-types'
import type { Worktree } from '../../../../shared/worktree/types'

const fetchHostedReviewForBranch = vi.fn()
const fetchIssue = vi.fn()
const fetchLinearIssue = vi.fn()
const openModal = vi.fn()
const updateWorktreeMeta = vi.fn()

let worktreeCardProperties: WorktreeCardProperty[] = []
let settings: Partial<GlobalSettings> | null = null
let groupBy = 'none'
let projectGroups: { id: string; name: string }[] = []
const WORKTREE_CARD_IMPORT_TIMEOUT_MS = 15_000
const NON_REPO_GROUPINGS = ['none', 'workspace-status', 'pr-status', 'task']
const PROJECT_LABEL_MARKER = 'data-worktree-card-project-label=""'
const META_ROW_MARKER = 'data-worktree-card-meta-row=""'
// Why: the card swaps py-2 for this padding as soon as it has a second line.
const TITLE_AND_SUBTITLE_PADDING = 'pt-1.25 pb-1.5'

vi.mock('@/store', () => ({
  useAppStore: (selector: (state: unknown) => unknown) =>
    selector({
      deleteStateByWorktreeId: {},
      fetchHostedReviewForBranch,
      fetchIssue,
      fetchLinearIssue,
      gitConflictOperationByWorktree: {},
      groupBy,
      hostedReviewCache: {},
      issueCache: {},
      linearIssueCache: {},
      openModal,
      projectGroups,
      remoteBranchConflictByWorktreeId: {},
      settings,
      sshConnectionStates: new Map(),
      sshTargetLabels: new Map(),
      updateWorktreeMeta,
      workspacePortScan: null,
      worktreeCardProperties
    })
}))

vi.mock('@/lib/worktree-activation', () => ({
  activateAndRevealWorktree: vi.fn()
}))

vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>
}))

vi.mock('./use-worktree-activity-status', () => ({
  useWorktreeActivityStatus: () => 'idle'
}))

vi.mock('./use-worktree-sleep-state', () => ({
  useIsSleepingWorktree: () => false
}))

vi.mock('./CacheTimer', () => ({
  default: () => null,
  usePromptCacheCountdownStartedAt: () => null
}))

vi.mock('./WorktreeCardAgents', () => ({
  default: () => null
}))

vi.mock('./WorktreeContextMenu', () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
  CLOSE_ALL_CONTEXT_MENUS_EVENT: 'orca:test-close-context-menus',
  WORKTREE_NATIVE_CONTEXT_MENU_ATTR: 'data-worktree-native-context-menu',
  WORKTREE_CONTEXT_MENU_SCOPE_ATTR: 'data-orca-context-menu-scope'
}))

function makeRepo(overrides: Partial<Repo> = {}): Repo {
  return {
    id: 'repo-1',
    path: '/repo',
    displayName: 'orca',
    badgeColor: '#999999',
    addedAt: 1,
    ...overrides
  }
}

function makeWorktree(overrides: Partial<Worktree> = {}): Worktree {
  return {
    id: 'repo-1::/repo/worktrees/feature',
    repoId: 'repo-1',
    path: '/repo/worktrees/feature',
    displayName: 'Feature tree',
    branch: 'refs/heads/feature/x',
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

function makeFolderWorktree(): Worktree {
  return folderWorkspaceToWorktree({
    id: 'fw-1',
    projectGroupId: 'group-1',
    name: 'Scratch notes',
    folderPath: '/notes/scratch',
    linkedTask: null,
    comment: '',
    isArchived: false,
    isUnread: false,
    isPinned: false,
    sortOrder: 0,
    lastActivityAt: 1,
    createdAt: 1,
    updatedAt: 1
  })
}

function projectLabelText(markup: string): string | null {
  const match = markup.match(/data-worktree-card-project-label=""><span[^>]*>([^<]*)</)
  return match ? (match[1] ?? null) : null
}

async function renderCard(props: {
  worktree?: Worktree
  repo?: Repo | undefined
  inPinnedSection?: boolean
  affiliateListMode?: boolean
}): Promise<string> {
  const { default: WorktreeCard } = await import('./WorktreeCard')
  return renderToStaticMarkup(
    <WorktreeCard
      worktree={props.worktree ?? makeWorktree()}
      repo={'repo' in props ? props.repo : makeRepo()}
      isActive={false}
      inPinnedSection={props.inPinnedSection}
      affiliateListMode={props.affiliateListMode}
    />
  )
}

describe('WorktreeCard project label', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    worktreeCardProperties = ['status']
    settings = null
    groupBy = 'none'
    projectGroups = [{ id: 'group-1', name: 'Client apps' }]
  })

  describe('Compact cards', () => {
    beforeEach(() => {
      settings = { compactWorktreeCards: true }
    })

    it.each(NON_REPO_GROUPINGS)(
      'names the project on its own line below the title when grouped by %s',
      async (value) => {
        groupBy = value

        const markup = await renderCard({})

        expect(projectLabelText(markup)).toBe('orca')
        expect(markup.indexOf('data-worktree-title-inline-rename')).toBeLessThan(
          markup.indexOf(PROJECT_LABEL_MARKER)
        )
        // Why: the line is its own row, not part of the metadata row, and the card stops being title-only.
        expect(markup).not.toContain(META_ROW_MARKER)
        expect(markup).toContain(TITLE_AND_SUBTITLE_PADDING)
      },
      WORKTREE_CARD_IMPORT_TIMEOUT_MS
    )

    it(
      'hides the label, and keeps the one-line card, under Project grouping',
      async () => {
        groupBy = 'repo'

        const markup = await renderCard({})

        expect(markup).not.toContain(PROJECT_LABEL_MARKER)
        expect(markup).not.toContain(TITLE_AND_SUBTITLE_PADDING)
      },
      WORKTREE_CARD_IMPORT_TIMEOUT_MS
    )

    it(
      'uses the project group name for a folder workspace',
      async () => {
        const markup = await renderCard({ worktree: makeFolderWorktree(), repo: undefined })

        expect(projectLabelText(markup)).toBe('Client apps')
        expect(markup).not.toContain(META_ROW_MARKER)
      },
      WORKTREE_CARD_IMPORT_TIMEOUT_MS
    )

    it(
      'omits the label, and keeps the one-line card, for a folder workspace whose project group is unknown',
      async () => {
        projectGroups = []

        const markup = await renderCard({ worktree: makeFolderWorktree(), repo: undefined })

        expect(markup).not.toContain(PROJECT_LABEL_MARKER)
        expect(markup).not.toContain(TITLE_AND_SUBTITLE_PADDING)
      },
      WORKTREE_CARD_IMPORT_TIMEOUT_MS
    )

    it(
      'omits the label in the right-sidebar affiliate list',
      async () => {
        const markup = await renderCard({ affiliateListMode: true })

        expect(markup).not.toContain(PROJECT_LABEL_MARKER)
      },
      WORKTREE_CARD_IMPORT_TIMEOUT_MS
    )
  })

  describe('new card style', () => {
    it.each(NON_REPO_GROUPINGS)(
      'names the project on its own line below the title when grouped by %s',
      async (value) => {
        settings = { compactWorktreeCards: false, experimentalNewWorktreeCardStyle: true }
        groupBy = value

        const markup = await renderCard({})

        expect(projectLabelText(markup)).toBe('orca')
        expect(markup.indexOf('data-worktree-title-inline-rename')).toBeLessThan(
          markup.indexOf(PROJECT_LABEL_MARKER)
        )
        expect(markup).not.toContain(META_ROW_MARKER)
        expect(markup).toContain(TITLE_AND_SUBTITLE_PADDING)
      },
      WORKTREE_CARD_IMPORT_TIMEOUT_MS
    )
  })

  describe('Default cards', () => {
    it.each(NON_REPO_GROUPINGS)(
      'keeps the existing meta-row repo badge instead of repeating the name when grouped by %s',
      async (value) => {
        groupBy = value

        const markup = await renderCard({})

        expect(markup).toContain(META_ROW_MARKER)
        expect(markup).toContain('>orca<')
        expect(markup).not.toContain(PROJECT_LABEL_MARKER)
      },
      WORKTREE_CARD_IMPORT_TIMEOUT_MS
    )

    it.each(NON_REPO_GROUPINGS)(
      'names the project group of a folder workspace in the meta row when grouped by %s',
      async (value) => {
        groupBy = value

        const markup = await renderCard({ worktree: makeFolderWorktree(), repo: undefined })

        expect(projectLabelText(markup)).toBe('Client apps')
        expect(markup.indexOf(META_ROW_MARKER)).toBeLessThan(markup.indexOf(PROJECT_LABEL_MARKER))
      },
      WORKTREE_CARD_IMPORT_TIMEOUT_MS
    )

    it(
      'names the project on pinned cards, which render the repo icon instead of the badge',
      async () => {
        const markup = await renderCard({
          worktree: makeWorktree({ isPinned: true }),
          inPinnedSection: true
        })

        expect(projectLabelText(markup)).toBe('orca')
        expect(markup.indexOf(META_ROW_MARKER)).toBeLessThan(markup.indexOf(PROJECT_LABEL_MARKER))
      },
      WORKTREE_CARD_IMPORT_TIMEOUT_MS
    )

    it(
      'hides the label for a folder workspace under Project grouping',
      async () => {
        groupBy = 'repo'

        const markup = await renderCard({ worktree: makeFolderWorktree(), repo: undefined })

        expect(markup).not.toContain(PROJECT_LABEL_MARKER)
      },
      WORKTREE_CARD_IMPORT_TIMEOUT_MS
    )
  })
})
