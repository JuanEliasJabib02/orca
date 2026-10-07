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
  SPOTLIGHT_STRAY_STARTUP_POLL_MS,
  SPOTLIGHT_STRAY_STARTUP_WATCH_MS,
  interruptStraySpotlightStartup
} from './spotlight-stray-startup-interrupt'

const REPO = 'repo-1'
const MAIN = 'main'
const TAB = 'spot'
const INTERRUPT = String.fromCharCode(3)

const pty = {
  hasChildProcesses: vi.fn(async (_id: string): Promise<boolean> => true),
  write: vi.fn((_id: string, _data: string, _inputKind: string): void => {})
}
// @ts-expect-error test window mock
globalThis.window = { api: { pty } }

function watch(): void {
  interruptStraySpotlightStartup({ repoId: REPO, worktreeId: MAIN, tabId: TAB })
}

beforeEach(() => {
  vi.useFakeTimers()
  pty.hasChildProcesses.mockReset()
  pty.hasChildProcesses.mockResolvedValue(true)
  pty.write.mockClear()
  // Spotlight is already off; the tab's pane is still spawning.
  resetSpotlightTerminalTestStore({
    tabsByWorktree: { [MAIN]: [makeTestTab({ id: TAB, worktreeId: MAIN })] }
  })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('interruptStraySpotlightStartup', () => {
  it('Ctrl-Cs the bound PTY once it runs a process, and only once', async () => {
    watch()

    bindTestTabPty(MAIN, TAB, 'pty-1')
    await vi.advanceTimersByTimeAsync(SPOTLIGHT_STRAY_STARTUP_POLL_MS * 2)

    expect(pty.write).toHaveBeenCalledWith('pty-1', INTERRUPT, 'driving')
    await vi.advanceTimersByTimeAsync(SPOTLIGHT_STRAY_STARTUP_WATCH_MS)
    expect(pty.write).toHaveBeenCalledTimes(1)
  })

  it('waits for the command to start, not for the bind', async () => {
    pty.hasChildProcesses.mockResolvedValue(false)
    watch()

    bindTestTabPty(MAIN, TAB, 'pty-1')
    await vi.advanceTimersByTimeAsync(SPOTLIGHT_STRAY_STARTUP_POLL_MS * 4)
    expect(pty.write).not.toHaveBeenCalled()

    pty.hasChildProcesses.mockResolvedValue(true)
    await vi.advanceTimersByTimeAsync(SPOTLIGHT_STRAY_STARTUP_POLL_MS * 2)

    expect(pty.write).toHaveBeenCalledTimes(1)
  })

  it('ignores a single reading, which could be a process of the shell startup files', async () => {
    pty.hasChildProcesses
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)
      .mockResolvedValue(false)
    watch()

    bindTestTabPty(MAIN, TAB, 'pty-1')
    await vi.advanceTimersByTimeAsync(SPOTLIGHT_STRAY_STARTUP_POLL_MS * 6)

    expect(pty.write).not.toHaveBeenCalled()
  })

  it('leaves the terminal alone when Spotlight comes back on', async () => {
    watch()

    bindTestTabPty(MAIN, TAB, 'pty-1')
    spotlightTerminalTestStore.setState({
      spotlightByRepo: { [REPO]: makeTestSpotlightState(REPO, 'feature') }
    })
    await vi.advanceTimersByTimeAsync(SPOTLIGHT_STRAY_STARTUP_POLL_MS * 4)

    expect(pty.write).not.toHaveBeenCalled()
  })

  it('stops when the tab closes before its PTY binds', async () => {
    watch()

    removeTestTab(MAIN, TAB)
    await vi.advanceTimersByTimeAsync(SPOTLIGHT_STRAY_STARTUP_WATCH_MS)

    expect(pty.hasChildProcesses).not.toHaveBeenCalled()
  })

  it('gives up when no PTY binds within the watch window', async () => {
    watch()

    await vi.advanceTimersByTimeAsync(SPOTLIGHT_STRAY_STARTUP_WATCH_MS)
    bindTestTabPty(MAIN, TAB, 'pty-1')
    await vi.advanceTimersByTimeAsync(SPOTLIGHT_STRAY_STARTUP_POLL_MS * 4)

    expect(pty.hasChildProcesses).not.toHaveBeenCalled()
    expect(pty.write).not.toHaveBeenCalled()
  })
})
