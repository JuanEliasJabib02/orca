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
import {
  SPOTLIGHT_STRAY_CHILD_PERSIST_MS,
  SPOTLIGHT_STRAY_STARTUP_POLL_MS
} from '../../../shared/spotlight-stray-startup'

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

describe('watchSpotlightStartupClaim reasons', () => {
  const onClaimed = vi.fn()

  beforeEach(() => {
    onClaimed.mockClear()
  })

  function watchWithClaim(): void {
    watchSpotlightStartupClaim({
      repoId: REPO,
      worktreeId: MAIN,
      tabId: TAB,
      onDropped,
      onUnclaimed,
      onClaimed
    })
  }

  it('reports the claim when the pane spends the command while Spotlight is on', () => {
    watchWithClaim()

    const queued = pending()
    bindTestTabPty(MAIN, TAB, 'pty-1')
    spotlightTerminalTestStore.getState().consumeTabStartupCommand(TAB, queued)
    vi.runAllTimers()

    expect(onClaimed).toHaveBeenCalledTimes(1)
    expect(onUnclaimed).not.toHaveBeenCalled()
  })

  it('names why each drop happened', async () => {
    watchWithClaim()
    vi.advanceTimersByTime(SPOTLIGHT_STARTUP_CLAIM_TIMEOUT_MS)
    expect(onDropped).toHaveBeenLastCalledWith('timeout')

    spotlightTerminalTestStore.getState().queueTabStartupCommand(TAB, { command: 'pnpm local' })
    watchWithClaim()
    removeTestTab(MAIN, TAB)
    expect(onDropped).toHaveBeenLastCalledWith('tab-closed')

    resetSpotlightTerminalTestStore({
      tabsByWorktree: { [MAIN]: [makeTestTab({ id: TAB, worktreeId: MAIN })] },
      pendingStartupByTabId: { [TAB]: { command: 'pnpm local' } }
    })
    watchWithClaim()
    bindTestTabPty(MAIN, TAB, 'pty-1')
    await vi.runAllTimersAsync()
    expect(onDropped).toHaveBeenLastCalledWith('spotlight-off')
    expect(onClaimed).not.toHaveBeenCalled()
  })
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

  it('keeps the command queued while Spotlight is off and the tab has not spawned', () => {
    watch()

    spotlightTerminalTestStore.setState({ spotlightByRepo: {} })

    expect(pending()).toEqual({ command: 'pnpm local' })
    expect(onDropped).not.toHaveBeenCalled()
    vi.advanceTimersByTime(SPOTLIGHT_STARTUP_CLAIM_TIMEOUT_MS)
    expect(pending()).toBeUndefined()
    expect(onDropped).toHaveBeenCalledTimes(1)
  })

  it("drops the previous activation's command when Spotlight comes back on before the tab spawns", async () => {
    watch()
    const { spotlightByRepo } = spotlightTerminalTestStore.getState()

    spotlightTerminalTestStore.setState({ spotlightByRepo: {} })
    expect(pending()).toEqual({ command: 'pnpm local' })
    spotlightTerminalTestStore.setState({ spotlightByRepo })

    expect(pending()).toBeUndefined()
    // Main forgot that launch at turn-off; cancelling now could take the new activation's.
    expect(onDropped).not.toHaveBeenCalled()
    // The new activation queues its own command, which the old watch leaves alone.
    spotlightTerminalTestStore.getState().queueTabStartupCommand(TAB, { command: 'pnpm dev' })
    bindTestTabPty(MAIN, TAB, 'pty-1')
    await vi.runAllTimersAsync()

    expect(pending()).toEqual({ command: 'pnpm dev' })
    expect(onUnclaimed).not.toHaveBeenCalled()
    expect(onDropped).not.toHaveBeenCalled()
    expect(pty.write).not.toHaveBeenCalled()
  })

  it('keeps a newer command queued while Spotlight was off when Spotlight comes back on', () => {
    watch()
    const { spotlightByRepo } = spotlightTerminalTestStore.getState()

    spotlightTerminalTestStore.setState({ spotlightByRepo: {} })
    spotlightTerminalTestStore.getState().queueTabStartupCommand(TAB, { command: 'pnpm dev' })
    spotlightTerminalTestStore.setState({ spotlightByRepo })

    expect(pending()).toEqual({ command: 'pnpm dev' })
    expect(onDropped).not.toHaveBeenCalled()
  })

  it('drops the command a PTY bound after Spotlight went off never read', async () => {
    watch()

    spotlightTerminalTestStore.setState({ spotlightByRepo: {} })
    bindTestTabPty(MAIN, TAB, 'pty-1')
    await vi.runAllTimersAsync()

    expect(pending()).toBeUndefined()
    expect(onDropped).toHaveBeenCalledTimes(1)
    expect(onUnclaimed).not.toHaveBeenCalled()
    expect(pty.hasChildProcesses).not.toHaveBeenCalled()
    expect(pty.write).not.toHaveBeenCalled()
  })

  it('interrupts the server a pane ran after Spotlight went off', async () => {
    let serverRunning = true
    pty.hasChildProcesses.mockImplementation(async () => serverRunning)
    pty.write.mockImplementation(() => {
      serverRunning = false
    })
    watch()

    spotlightTerminalTestStore.setState({ spotlightByRepo: {} })
    const queued = pending()
    bindTestTabPty(MAIN, TAB, 'pty-1')
    spotlightTerminalTestStore.getState().consumeTabStartupCommand(TAB, queued)
    await vi.advanceTimersByTimeAsync(
      SPOTLIGHT_STRAY_STARTUP_POLL_MS + SPOTLIGHT_STRAY_CHILD_PERSIST_MS
    )

    expect(pty.write).toHaveBeenCalledTimes(1)
    expect(pty.write).toHaveBeenCalledWith('pty-1', INTERRUPT, 'driving')
    await vi.advanceTimersByTimeAsync(SPOTLIGHT_STARTUP_CLAIM_TIMEOUT_MS)
    expect(pty.write).toHaveBeenCalledTimes(1)
  })

  it('never interrupts once the watcher dropped the command itself', async () => {
    watch()

    spotlightTerminalTestStore.setState({ spotlightByRepo: {} })
    vi.advanceTimersByTime(SPOTLIGHT_STARTUP_CLAIM_TIMEOUT_MS)
    bindTestTabPty(MAIN, TAB, 'pty-1')
    await vi.advanceTimersByTimeAsync(SPOTLIGHT_STARTUP_CLAIM_TIMEOUT_MS)

    expect(pty.hasChildProcesses).not.toHaveBeenCalled()
    expect(pty.write).not.toHaveBeenCalled()
  })

  it('leaves a PTY whose pane spent the command while Spotlight was on to main', async () => {
    watch()

    const queued = pending()
    bindTestTabPty(MAIN, TAB, 'pty-1')
    spotlightTerminalTestStore.getState().consumeTabStartupCommand(TAB, queued)
    spotlightTerminalTestStore.setState({ spotlightByRepo: {} })
    await vi.advanceTimersByTimeAsync(SPOTLIGHT_STARTUP_CLAIM_TIMEOUT_MS)

    expect(pty.hasChildProcesses).not.toHaveBeenCalled()
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
