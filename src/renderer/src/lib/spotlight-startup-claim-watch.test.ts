import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  bindTestTabPty,
  makeTestSpotlightState,
  makeTestTab,
  removeTestTab,
  resetSpotlightTerminalTestStore,
  spotlightTerminalTestStore
} from './spotlight-terminal-test-store'

vi.mock('@/store', async () => {
  const { spotlightTerminalTestStore: store } = await import('./spotlight-terminal-test-store')
  return { useAppStore: store }
})

import {
  SPOTLIGHT_STARTUP_CLAIM_TIMEOUT_MS,
  watchSpotlightStartupClaim
} from './spotlight-startup-claim-watch'

const REPO = 'repo-1'
const MAIN = 'main'
const TAB = 'spot'
const onUnclaimed = vi.fn()

function pending(): { command: string } | undefined {
  return spotlightTerminalTestStore.getState().pendingStartupByTabId[TAB]
}

function watch(): void {
  watchSpotlightStartupClaim({ repoId: REPO, worktreeId: MAIN, tabId: TAB, onUnclaimed })
}

beforeEach(() => {
  vi.useFakeTimers()
  onUnclaimed.mockClear()
  resetSpotlightTerminalTestStore({
    tabsByWorktree: { [MAIN]: [makeTestTab({ id: TAB, worktreeId: MAIN })] },
    spotlightByRepo: { [REPO]: makeTestSpotlightState(REPO, 'feature') },
    pendingStartupByTabId: { [TAB]: { command: 'pnpm local' } }
  })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('watchSpotlightStartupClaim', () => {
  it('does nothing when the pane spends the command as its PTY binds', () => {
    watch()

    const queued = pending()
    bindTestTabPty(MAIN, TAB, 'pty-1')
    spotlightTerminalTestStore.getState().consumeTabStartupCommand(TAB, queued)
    vi.runAllTimers()

    expect(onUnclaimed).not.toHaveBeenCalled()
    expect(pending()).toBeUndefined()
  })

  it('drops a command a pane mounted earlier never read, then hands over', () => {
    watch()

    bindTestTabPty(MAIN, TAB, 'pty-1')
    expect(onUnclaimed).not.toHaveBeenCalled()
    vi.advanceTimersByTime(0)

    expect(pending()).toBeUndefined()
    expect(onUnclaimed).toHaveBeenCalledTimes(1)
  })

  it('drops the command when Spotlight turns off before the spawn', () => {
    watch()

    spotlightTerminalTestStore.setState({ spotlightByRepo: {} })
    bindTestTabPty(MAIN, TAB, 'pty-1')
    vi.runAllTimers()

    expect(pending()).toBeUndefined()
    expect(onUnclaimed).not.toHaveBeenCalled()
  })

  it('stops when the tab closes', () => {
    watch()

    removeTestTab(MAIN, TAB)
    vi.runAllTimers()

    expect(pending()).toBeUndefined()
    expect(onUnclaimed).not.toHaveBeenCalled()
  })

  it('drops the command when no pane spawns in time, so it never runs late', () => {
    watch()

    vi.advanceTimersByTime(SPOTLIGHT_STARTUP_CLAIM_TIMEOUT_MS)
    bindTestTabPty(MAIN, TAB, 'pty-1')
    vi.runAllTimers()

    expect(pending()).toBeUndefined()
    expect(onUnclaimed).not.toHaveBeenCalled()
  })

  it('leaves a newer queued command alone', () => {
    watch()

    spotlightTerminalTestStore.getState().queueTabStartupCommand(TAB, { command: 'other' })
    vi.advanceTimersByTime(SPOTLIGHT_STARTUP_CLAIM_TIMEOUT_MS)

    expect(pending()).toEqual({ command: 'other' })
    expect(onUnclaimed).not.toHaveBeenCalled()
  })
})
