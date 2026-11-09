// @vitest-environment happy-dom

import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getWorktreeCardDetails } from '../../../../../../shared/worktree/card-properties'
import { useAppStore } from '@/store'
import type { GlobalSettings } from '../../../../../../shared/global-settings-types'
import type { Worktree } from '../../../../../../shared/worktree/types'
import { makeOwnedPort } from '../../spotlight-holder-ports-test-fixtures'
import { useWorktreeCardSecondaryDetails } from './use-worktree-card-secondary-details'

const mocks = vi.hoisted(() => ({ toastError: vi.fn() }))
vi.mock('sonner', () => ({ toast: { error: mocks.toastError } }))

const WORKTREE_ID = 'repo-1::/repo/worktrees/card'
const originalState = useAppStore.getState()

let root: Root | null = null
let container: HTMLDivElement | null = null

function mount(node: ReactNode): void {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root?.render(node))
}

function unmount(): void {
  if (root) {
    act(() => root?.unmount())
  }
  root = null
  container?.remove()
  container = null
}

function makeWorktree(): Worktree {
  return {
    id: WORKTREE_ID,
    repoId: 'repo-1',
    path: '/repo/worktrees/card',
    displayName: 'Card',
    branch: 'feature/card',
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
    lastActivityAt: 1
  }
}

function makeSettings(promptCacheTtlMs: number): GlobalSettings {
  return { promptCacheTimerEnabled: true, promptCacheTtlMs } as GlobalSettings
}

function secondaryDetailsArgs(settings: GlobalSettings) {
  return {
    worktree: makeWorktree(),
    repo: undefined,
    statusPrDisplay: null,
    showStatus: false,
    showIssue: false,
    showLinearIssue: false,
    showJiraIssue: false,
    showPR: false,
    showAutomation: false,
    showCli: false,
    showComment: false,
    showPorts: false,
    issueDisplay: null,
    linearIssue: null,
    linearIssueDisplay: null,
    jiraIssueDisplay: null,
    prDisplay: null,
    linkedGitLabMR: null,
    linkedBitbucketPR: null,
    linkedAzureDevOpsPR: null,
    linkedGiteaPR: null,
    newCardStyle: false,
    compactCards: false,
    cardDetails: getWorktreeCardDetails([], { compactWorktreeCards: false, newCardStyle: false }),
    agentActivityDisplayMode: 'compact' as const,
    workspacePorts: [],
    openTaskPage: (() => {}) as never,
    updateWorktreeMeta: (() => {}) as never,
    settings
  }
}

afterEach(() => {
  unmount()
  useAppStore.setState(originalState, true)
})

describe('useWorktreeCardSecondaryDetails hasPorts', () => {
  const ports = [makeOwnedPort(WORKTREE_ID, 8080)]

  function readHasPorts(overrides: Record<string, unknown>): boolean {
    let hasPorts = false
    function Probe(): null {
      hasPorts = useWorktreeCardSecondaryDetails({
        ...secondaryDetailsArgs(makeSettings(300_000)),
        workspacePorts: ports,
        ...overrides
      }).hasPorts
      return null
    }
    mount(<Probe />)
    unmount()
    return hasPorts
  }

  it('follows the Ports property for an ordinary row', () => {
    expect(readHasPorts({ showPorts: true })).toBe(true)
    expect(readHasPorts({ showPorts: false })).toBe(false)
  })

  it('shows a row with a Spotlight port label even with the Ports property off', () => {
    expect(readHasPorts({ showPorts: false, spotlightPortLabel: ':8080' })).toBe(true)
  })

  it('shows nothing without ports', () => {
    expect(readHasPorts({ showPorts: true, spotlightPortLabel: ':8080', workspacePorts: [] })).toBe(
      false
    )
  })
})
