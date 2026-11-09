// @vitest-environment happy-dom

import React, { type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GlobalSettings } from '../../../../../../shared/global-settings-types'
import type { Repo } from '../../../../../../shared/repo-types'
import type { WorktreeCardProperty } from '../../../../../../shared/ui-chrome-types'
import type { Worktree } from '../../../../../../shared/worktree/types'
import { DEFAULT_WORKTREE_CARD_PROPERTIES } from '../../../../../../shared/worktree/card-properties'
import type { WorktreeCardProps } from '../controller/worktree-card-model'
import { makeOwnedPort, makePortScan } from '../../spotlight-holder-ports-test-fixtures'

type Mocks = {
  state: Record<string, unknown>
  cacheStartedAt: number | null
  deleteModifier: boolean
}
const mocks = vi.hoisted((): Mocks => ({
  state: {},
  cacheStartedAt: null,
  deleteModifier: false
}))

vi.mock('@/store', () => {
  const getState = () => mocks.state
  return {
    useAppStore: Object.assign((selector: (state: unknown) => unknown) => selector(getState()), {
      getState
    })
  }
})
vi.mock('@/components/ui/hover-card', () => ({
  HoverCard: ({ children, open }: { children: ReactNode; open?: boolean }) => (
    <div data-hover-card="" data-hover-open={Boolean(open)}>
      {children}
    </div>
  ),
  HoverCardContent: ({ children }: { children: ReactNode }) => (
    <div data-hover-card-content="">{children}</div>
  ),
  HoverCardTrigger: ({ children }: { children: ReactNode }) =>
    React.isValidElement<Record<string, unknown>>(children) ? (
      React.cloneElement(children, { 'data-hover-card-trigger': '' })
    ) : (
      <>{children}</>
    )
}))
vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: ReactNode }) => (
    <span data-tooltip="">{children}</span>
  ),
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>
}))
vi.mock('../activity/use-worktree-activity-status', () => ({
  useWorktreeActivityStatus: () => 'active'
}))
vi.mock('../../workspace-actions/sleep/use-worktree-sleep-state', () => ({
  useIsSleepingWorktree: () => false
}))
vi.mock('../activity/CacheTimer', () => ({
  default: ({ startedAt }: { startedAt: number }) => <span data-cache-timer={startedAt} />,
  usePromptCacheCountdownStartedAt: () => mocks.cacheStartedAt
}))
vi.mock('../activity/WorktreeCardAgents', () => ({
  default: ({ className }: { className?: string }) => (
    <div className={className} data-worktree-agents="" />
  )
}))
vi.mock('../identity/WorktreeLineageToggle', () => ({
  WorktreeLineageToggle: ({ count, label }: { count: number; label: string }) => (
    <button type="button" data-lineage-toggle={count}>
      {label}
    </button>
  )
}))
vi.mock(
  '../../workspace-actions/deletion/workspace-delete-quick-action',
  async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    useWorkspaceDeleteModifierPressed: () => mocks.deleteModifier
  })
)

const { useWorktreeCardController } = await import('../controller/use-worktree-card-controller')
const { buildWorktreeCardPresentation } = await import('../surface/worktree-card-presentation')
const { WorktreeCardParentContent } = await import('../surface/worktree-card-parent-content')
const { getWorktreeCardFrameGeometry } = await import('../surface/worktree-card-frame-geometry')
const { DEFAULT_WORKSPACE_CARD_TEMPLATE } = await import('./default-workspace-card')
const { renderWorkspaceCardTemplate } = await import('./render-workspace-card-template')

const repo: Repo = {
  id: 'repo-1',
  path: '/repo',
  displayName: 'orca',
  badgeColor: '#999999',
  addedAt: 1
}

function makeWorktree(overrides: Partial<Worktree> = {}): Worktree {
  return {
    id: 'repo-1::/repo/worktrees/feature',
    repoId: 'repo-1',
    path: '/repo/worktrees/feature',
    displayName: 'Card plugins',
    branch: 'refs/heads/feature/card-plugins',
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

type Case = {
  worktree?: Partial<Worktree>
  repo?: Partial<Repo> | null
  props?: Partial<WorktreeCardProps>
  state?: Record<string, unknown>
  cardProps?: WorktreeCardProperty[]
}

const wt = makeWorktree()
const rootWt = makeWorktree({
  id: 'repo-1::/repo',
  path: '/repo',
  displayName: 'orca',
  isMainWorktree: true,
  branch: 'refs/heads/main'
})
const spotlightRepo: Partial<Repo> = { spotlightTestingEnabled: true }
function spotlightOn(lastError: { code: string; message: string } | null = null) {
  return {
    spotlightByRepo: {
      'repo-1': { repoId: 'repo-1', holderWorktreeId: wt.id, status: 'active', lastError }
    },
    worktreesByRepo: { 'repo-1': [rootWt, wt] }
  }
}
const CASES: Record<string, Case> = {
  spotlightRoot: { worktree: rootWt, repo: spotlightRepo, state: spotlightOn() },
  spotlightRootDetached: {
    worktree: { ...rootWt, branch: '', head: 'deadbeef' },
    repo: spotlightRepo,
    state: spotlightOn()
  },
  spotlightRootDiverged: {
    worktree: { ...rootWt, branch: '', head: 'deadbeef' },
    repo: spotlightRepo,
    state: spotlightOn({ code: 'root-diverged', message: 'root moved' })
  },
  spotlightToggle: { repo: spotlightRepo },
  spotlightHolder: { repo: spotlightRepo, state: spotlightOn() },
  spotlightPortWithPortsOff: {
    cardProps: ['status'],
    repo: spotlightRepo,
    state: { ...spotlightOn(), workspacePortScan: makePortScan([makeOwnedPort(rootWt.id, 58941)]) }
  },
  projectLabel: { state: { groupBy: 'none' } },
  projectLabelPinned: { props: { inPinnedSection: true }, state: { groupBy: 'task' } },
  projectLabelFolder: {
    repo: null,
    worktree: { repoId: 'folder-workspace:g1', branch: '' },
    state: { groupBy: 'none', projectGroups: [{ id: 'g1', name: 'Client apps' }] }
  },
  projectLabelAffiliate: { props: { affiliateListMode: true }, state: { groupBy: 'none' } }
}

// Proof each case draws what it is named for, so a parity pass is not two empty cards.
const SHOWS: Partial<Record<keyof typeof CASES, string | readonly string[]>> = {
  spotlightRoot: ['data-worktree-card-spotlight-bar', 'Spotlight is on'],
  spotlightRootDetached: 'Spotlight is on',
  spotlightRootDiverged: 'Spotlight is on',
  spotlightToggle: 'Spotlight this workspace',
  spotlightHolder: 'Click to turn off',
  spotlightPortWithPortsOff: '1 live port :58941',
  projectLabelPinned: 'data-worktree-card-project-label',
  projectLabelFolder: 'Client apps'
}
// What a case must leave out in every style.
const HIDES: Partial<Record<keyof typeof CASES, string>> = {
  // Spotlight detaches the root on purpose, so its badge would only be noise.
  spotlightRootDetached: 'Detached HEAD',
  projectLabelAffiliate: 'data-worktree-card-project-label'
}

const STYLES: Record<string, Partial<GlobalSettings>> = {
  classic: { compactWorktreeCards: false },
  compact: { compactWorktreeCards: true },
  new: { experimentalNewWorktreeCardStyle: true }
}

function stateFor(style: Partial<GlobalSettings>, testCase: Case): Record<string, unknown> {
  return {
    agentActivityDisplayMode: 'full',
    deleteStateByWorktreeId: {},
    gitConflictOperationByWorktree: {},
    hostedReviewCache: {},
    issueCache: {},
    linearIssueCache: {},
    prCache: {},
    projectGroups: [],
    // The app's default grouping, whose section headers already name the project.
    groupBy: 'repo',
    remoteBranchConflictByWorktreeId: {},
    runtimeEnvironments: [],
    settings: { ...style },
    sshConnectionStates: new Map(),
    removedSshTargetLabels: new Map(),
    runtimeStatusByEnvironmentId: new Map(),
    sshTargetLabels: new Map(),
    tabsByWorktree: {},
    agentStatusByPaneKey: {},
    retainedAgentsByPaneKey: {},
    workspacePortScan: null,
    worktreeCardProperties: testCase.cardProps ?? [...DEFAULT_WORKTREE_CARD_PROPERTIES],
    ...testCase.state
  }
}

function Harness({ props, variant }: { props: WorktreeCardProps; variant: 'legacy' | 'template' }) {
  const card = useWorktreeCardController({
    isActiveSurface: props.isActive,
    activeSurfaceVariant: 'primary',
    isMultiSelected: false,
    revealHighlight: false,
    revealHighlightTone: 'default',
    nativeDragEnabled: true,
    inPinnedSection: false,
    contentIndent: 0,
    flushSurface: false,
    lineageChildCount: 0,
    lineageCollapsed: false,
    isLineageDropTarget: false,
    affiliateListMode: false,
    statusPrDisplay: null,
    ...props
  })
  if (variant === 'legacy') {
    const presentation = buildWorktreeCardPresentation(card)
    return (
      <div
        data-single-line={presentation.titleOnlyCard}
        data-style={JSON.stringify(presentation.cardStyle ?? null)}
      >
        <WorktreeCardParentContent card={card} presentation={presentation} />
      </div>
    )
  }
  const geometryFor = (statusLane: boolean) =>
    getWorktreeCardFrameGeometry({
      flushSurface: card.flushSurface,
      contentIndent: card.contentIndent,
      statusLane
    })
  const { content, frame } = renderWorkspaceCardTemplate(
    card,
    DEFAULT_WORKSPACE_CARD_TEMPLATE,
    (f) => {
      const margin = geometryFor(f.statusLane).parentContentMarginLeft
      return margin < 0 ? { style: { marginLeft: `${margin}px` } } : undefined
    }
  )
  return (
    <div
      data-single-line={frame.singleLine}
      data-style={JSON.stringify(geometryFor(frame.statusLane).cardStyle ?? null)}
    >
      {content}
    </div>
  )
}

/** Attribute order and class token order do not change what the browser draws. */
function canonical(html: string): string {
  const host = document.createElement('div')
  host.innerHTML = html
  const walk = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) {
      return node.textContent ?? ''
    }
    if (!(node instanceof Element)) {
      return ''
    }
    const attrs = [...node.attributes]
      .map((attr) =>
        attr.name === 'class'
          ? `class="${attr.value.split(/\s+/).filter(Boolean).sort().join(' ')}"`
          : `${attr.name}="${attr.value}"`
      )
      .sort()
    return `<${node.localName} ${attrs.join(' ')}>${[...node.childNodes].map(walk).join('')}</${node.localName}>`
  }
  // React's generated ids depend on tree position, not on what is drawn.
  const ids = new Map<string, string>()
  return [...host.childNodes]
    .map(walk)
    .join('')
    .replace(/_R_[A-Za-z0-9]+_/g, (id) => {
      if (!ids.has(id)) {
        ids.set(id, `id${ids.size}`)
      }
      return ids.get(id) ?? id
    })
}

// Why a window: full card markup is too long for a readable assertion diff.
function aroundFirstDifference(actual: string, expected: string): [string, string] {
  let index = 0
  while (index < actual.length && actual[index] === expected[index]) {
    index++
  }
  const start = Math.max(0, index - 120)
  return [actual.slice(start, index + 240), expected.slice(start, index + 240)]
}

describe('default workspace card template parity for Spotlight and the project label', () => {
  beforeEach(() => {
    mocks.cacheStartedAt = null
    mocks.deleteModifier = false
  })
  afterEach(cleanup)

  for (const [styleName, style] of Object.entries(STYLES)) {
    for (const [caseName, testCase] of Object.entries(CASES)) {
      it(`${styleName}: ${caseName}`, () => {
        mocks.state = stateFor(style, testCase)
        const props: WorktreeCardProps = {
          worktree: makeWorktree(testCase.worktree),
          repo: testCase.repo === null ? undefined : { ...repo, ...testCase.repo },
          isActive: false,
          ...testCase.props
        }
        const legacy = canonical(renderToStaticMarkup(<Harness props={props} variant="legacy" />))
        const template = canonical(
          renderToStaticMarkup(<Harness props={props} variant="template" />)
        )
        for (const text of [SHOWS[caseName] ?? []].flat()) {
          expect(legacy).toContain(text)
        }
        const hides = HIDES[caseName]
        if (hides) {
          expect(legacy).not.toContain(hides)
        }
        const [actualWindow, expectedWindow] = aroundFirstDifference(template, legacy)
        expect(actualWindow).toBe(expectedWindow)
      })
    }
  }
})
