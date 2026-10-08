// Test-only stand-in for `useAppStore` in the Spotlight terminal/autostart tests: just the state
// and actions those modules touch, with synchronous subscribers like zustand's.
import { vi, type Mock } from 'vitest'
import type { Repo } from '../../../shared/repo-types'
import type { SpotlightRepoState } from '../../../shared/spotlight'
import type { SpotlightServerEnv } from '../../../shared/spotlight-server-types'
import type { TerminalTab } from '../../../shared/terminal-tab-types'
import type { Worktree } from '../../../shared/worktree/types'

export type SpotlightTerminalTestData = {
  repos: Pick<Repo, 'id' | 'spotlightServer'>[]
  worktreesByRepo: Record<string, Worktree[]>
  tabsByWorktree: Record<string, TerminalTab[]>
  activeTabIdByWorktree: Record<string, string | null>
  spotlightEnvByTaskKey: Record<string, SpotlightServerEnv>
  spotlightByRepo: Record<string, SpotlightRepoState>
  pendingStartupByTabId: Record<string, { command: string }>
  pendingInitialCwdByTabId: Record<string, string>
}

type Listener = (state: SpotlightTerminalTestState) => void

/** Call order across the store and the mocked IPC, for "prepare → queue → mount" assertions. */
export const spotlightTerminalEvents: string[] = []

const listeners = new Set<Listener>()
let tabSeq = 0

function emptyData(): SpotlightTerminalTestData {
  return {
    repos: [],
    worktreesByRepo: {},
    tabsByWorktree: {},
    activeTabIdByWorktree: {},
    spotlightEnvByTaskKey: {},
    spotlightByRepo: {},
    pendingStartupByTabId: {},
    pendingInitialCwdByTabId: {}
  }
}

export function makeTestWorktree(
  overrides: Partial<Worktree> & { id: string; repoId: string }
): Worktree {
  return {
    path: `/${overrides.repoId}/${overrides.id}`,
    head: 'abc123',
    branch: 'refs/heads/feature',
    isBare: false,
    isMainWorktree: false,
    displayName: 'feature',
    comment: '',
    linkedIssue: null,
    linkedPR: null,
    linkedLinearIssue: null,
    linkedGitLabMR: null,
    linkedGitLabIssue: null,
    isArchived: false,
    isUnread: false,
    isPinned: false,
    sortOrder: 0,
    lastActivityAt: 0,
    ...overrides
  }
}

export function makeTestTab(
  overrides: Partial<TerminalTab> & { id: string; worktreeId: string }
): TerminalTab {
  return {
    ptyId: null,
    title: 'Terminal 1',
    customTitle: null,
    color: null,
    sortOrder: 0,
    createdAt: 0,
    ...overrides
  }
}

export function makeTestSpotlightState(
  repoId: string,
  holderWorktreeId: string
): SpotlightRepoState {
  return {
    repoId,
    holderWorktreeId,
    status: 'active',
    originalBranch: 'main',
    originalHeadSha: 'abc',
    backupSha: 'abc',
    lastSnapshotSha: 'def',
    activatedAt: 0,
    lastSyncAt: null,
    lastError: null
  }
}

// Why explicit: the exported state type must not depend on vitest's unexported spy types.
type SpotlightTerminalTestActions = {
  createTab: Mock<
    (
      worktreeId: string,
      targetGroupId?: string,
      shellOverride?: string,
      options?: { spotlightRepoRoot?: boolean }
    ) => TerminalTab
  >
  queueTabStartupCommand: Mock<(tabId: string, startup: { command: string }) => void>
  consumeTabStartupCommand: Mock<
    (tabId: string, expected?: { command: string }) => { command: string } | null
  >
  queueTabInitialCwd: Mock<(tabId: string, cwd: string) => void>
  clearTabPtyId: Mock<(tabId: string, ptyId?: string) => void>
  markTabSpotlightRepoRoot: Mock<(tabId: string) => void>
  setTabCustomTitle: Mock<(...args: unknown[]) => void>
  setActiveTabForWorktree: Mock<(...args: unknown[]) => void>
  setActiveTabType: Mock<(...args: unknown[]) => void>
}

function createActions(): SpotlightTerminalTestActions {
  return {
    createTab: vi.fn(
      (
        worktreeId: string,
        _targetGroupId?: string,
        _shellOverride?: string,
        options?: { spotlightRepoRoot?: boolean }
      ): TerminalTab => {
        spotlightTerminalEvents.push('createTab')
        tabSeq += 1
        const tab = makeTestTab({
          id: `created-${tabSeq}`,
          worktreeId,
          ...(options?.spotlightRepoRoot ? { spotlightRepoRoot: true } : {})
        })
        updateTabs(worktreeId, (tabs) => [...tabs, tab])
        return tab
      }
    ),
    queueTabStartupCommand: vi.fn((tabId: string, startup: { command: string }) => {
      spotlightTerminalEvents.push('queue')
      setState({
        pendingStartupByTabId: { ...state.pendingStartupByTabId, [tabId]: { ...startup } }
      })
    }),
    consumeTabStartupCommand: vi.fn(
      (tabId: string, expected?: { command: string }): { command: string } | null => {
        const pending = state.pendingStartupByTabId[tabId]
        if (!pending || (expected && pending !== expected)) {
          return null
        }
        const next = { ...state.pendingStartupByTabId }
        delete next[tabId]
        setState({ pendingStartupByTabId: next })
        return pending
      }
    ),
    queueTabInitialCwd: vi.fn((tabId: string, cwd: string) => {
      setState({ pendingInitialCwdByTabId: { ...state.pendingInitialCwdByTabId, [tabId]: cwd } })
    }),
    clearTabPtyId: vi.fn((tabId: string, ptyId?: string) => {
      spotlightTerminalEvents.push('clearPty')
      for (const worktreeId of Object.keys(state.tabsByWorktree)) {
        updateTabs(worktreeId, (tabs) =>
          tabs.map((tab) =>
            tab.id === tabId && (ptyId === undefined || tab.ptyId === ptyId)
              ? { ...tab, ptyId: null }
              : tab
          )
        )
      }
    }),
    markTabSpotlightRepoRoot: vi.fn((tabId: string) => {
      for (const worktreeId of Object.keys(state.tabsByWorktree)) {
        updateTabs(worktreeId, (tabs) =>
          tabs.map((tab) => (tab.id === tabId ? { ...tab, spotlightRepoRoot: true } : tab))
        )
      }
    }),
    setTabCustomTitle: vi.fn<(...args: unknown[]) => void>(),
    setActiveTabForWorktree: vi.fn<(...args: unknown[]) => void>(),
    setActiveTabType: vi.fn<(...args: unknown[]) => void>()
  }
}

export type SpotlightTerminalTestState = SpotlightTerminalTestData & SpotlightTerminalTestActions

let state: SpotlightTerminalTestState = { ...emptyData(), ...createActions() }

function setState(patch: Partial<SpotlightTerminalTestData>): void {
  state = { ...state, ...patch }
  for (const listener of listeners) {
    listener(state)
  }
}

function updateTabs(worktreeId: string, update: (tabs: TerminalTab[]) => TerminalTab[]): void {
  setState({
    tabsByWorktree: {
      ...state.tabsByWorktree,
      [worktreeId]: update(state.tabsByWorktree[worktreeId] ?? [])
    }
  })
}

/** Mocked as `useAppStore`: `vi.mock('@/store', ...)` returns `{ useAppStore: this }`. */
export const spotlightTerminalTestStore = {
  getState: (): SpotlightTerminalTestState => state,
  setState,
  subscribe: (listener: Listener): (() => void) => {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }
}

export function resetSpotlightTerminalTestStore(data: Partial<SpotlightTerminalTestData>): void {
  listeners.clear()
  spotlightTerminalEvents.length = 0
  tabSeq = 0
  state = { ...emptyData(), ...data, ...createActions() }
}

/** What a pane does when its PTY spawns: binds it to the tab (and may then spend its startup). */
export function bindTestTabPty(worktreeId: string, tabId: string, ptyId: string): void {
  updateTabs(worktreeId, (tabs) => tabs.map((tab) => (tab.id === tabId ? { ...tab, ptyId } : tab)))
}

export function removeTestTab(worktreeId: string, tabId: string): void {
  updateTabs(worktreeId, (tabs) => tabs.filter((tab) => tab.id !== tabId))
}
