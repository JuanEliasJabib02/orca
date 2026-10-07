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
import { SPOTLIGHT_STRAY_STARTUP_POLL_MS } from './spotlight-stray-startup-interrupt'

const REPO = 'repo-1'
const MAIN = 'main'
const TAB = 'spot'
const INTERRUPT = String.fromCharCode(3)
const onUnclaimed = vi.fn()
const onDropped = vi.fn()

const pty = {
  hasChildProcesses: vi.fn(async (_id: string): Promise<boolean> => true),
  write: vi.fn((_id: string, _data: string, _inputKind: string): void => {})
}
// @ts-expect-error test window mock
globalThis.window = { api: { pty } }

function pending(): { command: string } | undefined {
  return spotlightTerminalTestStore.getState().pendingStartupByTabId[TAB]
}

function watch(): void {
  watchSpotlightStartupClaim({ repoId: REPO, worktreeId: MAIN, tabId: TAB, onDropped, onUnclaimed })
}

beforeEach(() => {
  vi.useFakeTimers()
  onUnclaimed.mockClear()
  onDropped.mockClear()
  pty.hasChildProcesses.mockReset()
  pty.hasChildProcesses.mockResolvedValue(true)
  pty.write.mockClear()
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
    expect(onDropped).not.toHaveBeenCalled()
    expect(pending()).toBeUndefined()
  })

  it('drops a command a pane mounted earlier never read, then hands over', () => {
    watch()

    bindTestTabPty(MAIN, TAB, 'pty-1')
    expect(onUnclaimed).not.toHaveBeenCalled()
    vi.advanceTimersByTime(0)

    expect(pending()).toBeUndefined()
    expect(onUnclaimed).toHaveBeenCalledTimes(1)
    // The hand-over path cancels the prepared line itself, before its live start.
    expect(onDropped).not.toHaveBeenCalled()
  })

  it('drops the command when Spotlight turns off before the spawn', async () => {
    pty.hasChildProcesses.mockResolvedValue(false)
    watch()

    spotlightTerminalTestStore.setState({ spotlightByRepo: {} })
    bindTestTabPty(MAIN, TAB, 'pty-1')
    await vi.runAllTimersAsync()

    expect(pending()).toBeUndefined()
    expect(onDropped).toHaveBeenCalledTimes(1)
    expect(onUnclaimed).not.toHaveBeenCalled()
    expect(pty.write).not.toHaveBeenCalled()
  })

  it('interrupts what a spawn already under way runs once Spotlight is off', async () => {
    watch()

    spotlightTerminalTestStore.setState({ spotlightByRepo: {} })
    bindTestTabPty(MAIN, TAB, 'pty-1')
    await vi.advanceTimersByTimeAsync(SPOTLIGHT_STRAY_STARTUP_POLL_MS * 2)

    expect(pty.write).toHaveBeenCalledTimes(1)
    expect(pty.write).toHaveBeenCalledWith('pty-1', INTERRUPT, 'driving')
    await vi.advanceTimersByTimeAsync(SPOTLIGHT_STRAY_STARTUP_POLL_MS * 4)
    expect(pty.write).toHaveBeenCalledTimes(1)
  })

  it('does not interrupt a PTY whose pane never read the command', async () => {
    watch()

    // The PTY shows up bound and the command still queued: its pane mounted before the queue.
    spotlightTerminalTestStore.setState({
      spotlightByRepo: {},
      tabsByWorktree: { [MAIN]: [makeTestTab({ id: TAB, worktreeId: MAIN, ptyId: 'pty-1' })] }
    })
    await vi.runAllTimersAsync()

    expect(onDropped).toHaveBeenCalledTimes(1)
    expect(pty.write).not.toHaveBeenCalled()
  })

  it('stops when the tab closes', () => {
    watch()

    removeTestTab(MAIN, TAB)
    vi.runAllTimers()

    expect(pending()).toBeUndefined()
    expect(onDropped).toHaveBeenCalledTimes(1)
    expect(onUnclaimed).not.toHaveBeenCalled()
  })

  it('reports the drop when the queue entry goes away with its tab', () => {
    watch()

    const store = spotlightTerminalTestStore.getState()
    spotlightTerminalTestStore.setState({
      pendingStartupByTabId: {},
      tabsByWorktree: { ...store.tabsByWorktree, [MAIN]: [] }
    })

    expect(onDropped).toHaveBeenCalledTimes(1)
    expect(onUnclaimed).not.toHaveBeenCalled()
  })

  it('drops the command when no pane spawns in time, so it never runs late', () => {
    watch()

    vi.advanceTimersByTime(SPOTLIGHT_STARTUP_CLAIM_TIMEOUT_MS)
    bindTestTabPty(MAIN, TAB, 'pty-1')
    vi.runAllTimers()

    expect(pending()).toBeUndefined()
    expect(onDropped).toHaveBeenCalledTimes(1)
    expect(onUnclaimed).not.toHaveBeenCalled()
  })

  it('leaves a newer queued command alone', () => {
    watch()

    spotlightTerminalTestStore.getState().queueTabStartupCommand(TAB, { command: 'other' })
    vi.advanceTimersByTime(SPOTLIGHT_STARTUP_CLAIM_TIMEOUT_MS)

    expect(pending()).toEqual({ command: 'other' })
    expect(onUnclaimed).not.toHaveBeenCalled()
    // The newer command's own launch is main's prepared one now; it must not be cancelled.
    expect(onDropped).not.toHaveBeenCalled()
  })
})
