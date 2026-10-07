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
  SPOTLIGHT_STRAY_CHILD_PERSIST_MS,
  SPOTLIGHT_STRAY_STARTUP_POLL_MS,
  SPOTLIGHT_STRAY_STARTUP_WATCH_MS
} from '../../../shared/spotlight-stray-startup'
import { interruptStraySpotlightStartup } from './spotlight-stray-startup-interrupt'

const REPO = 'repo-1'
const MAIN = 'main'
const TAB = 'spot'
const PTY = 'pty-1'
const INTERRUPT = String.fromCharCode(3)
// Past the first reading plus the persistence window.
const PERSISTED_MS = SPOTLIGHT_STRAY_STARTUP_POLL_MS + SPOTLIGHT_STRAY_CHILD_PERSIST_MS

let childRunning = true
// A Ctrl-C ends the child unless the test says it survives.
let childSurvivesInterrupt = false

const pty = {
  hasChildProcesses: vi.fn(async (_id: string): Promise<boolean> => childRunning),
  write: vi.fn((_id: string, _data: string, _inputKind: string): void => {
    childRunning = childSurvivesInterrupt
  })
}
// @ts-expect-error test window mock
globalThis.window = { api: { pty } }

function watch(): void {
  interruptStraySpotlightStartup({ repoId: REPO, worktreeId: MAIN, tabId: TAB, ptyId: PTY })
}

beforeEach(() => {
  vi.useFakeTimers()
  childRunning = true
  childSurvivesInterrupt = false
  pty.hasChildProcesses.mockClear()
  pty.write.mockClear()
  // Spotlight is already off; the pane spent the queued line on its PTY.
  resetSpotlightTerminalTestStore({
    tabsByWorktree: { [MAIN]: [makeTestTab({ id: TAB, worktreeId: MAIN, ptyId: PTY })] }
  })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('interruptStraySpotlightStartup', () => {
  it('Ctrl-Cs a child once it persists, and only once when that stops it', async () => {
    watch()

    await vi.advanceTimersByTimeAsync(PERSISTED_MS - SPOTLIGHT_STRAY_STARTUP_POLL_MS)
    expect(pty.write).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(SPOTLIGHT_STRAY_STARTUP_POLL_MS)

    expect(pty.write).toHaveBeenCalledWith(PTY, INTERRUPT, 'driving')
    await vi.advanceTimersByTimeAsync(SPOTLIGHT_STRAY_STARTUP_WATCH_MS)
    expect(pty.write).toHaveBeenCalledTimes(1)
  })

  it('leaves a startup-file child that exits alone', async () => {
    watch()

    await vi.advanceTimersByTimeAsync(SPOTLIGHT_STRAY_CHILD_PERSIST_MS - 500)
    childRunning = false
    await vi.advanceTimersByTimeAsync(SPOTLIGHT_STRAY_STARTUP_WATCH_MS)

    expect(pty.write).not.toHaveBeenCalled()
  })

  it('sends one follow-up to a child that outlives the first Ctrl-C, and no more', async () => {
    childSurvivesInterrupt = true
    watch()

    await vi.advanceTimersByTimeAsync(SPOTLIGHT_STRAY_STARTUP_WATCH_MS)

    expect(pty.write).toHaveBeenCalledTimes(2)
  })

  it('leaves the terminal alone when Spotlight comes back on', async () => {
    watch()

    spotlightTerminalTestStore.setState({
      spotlightByRepo: { [REPO]: makeTestSpotlightState(REPO, 'feature') }
    })
    await vi.advanceTimersByTimeAsync(SPOTLIGHT_STRAY_STARTUP_WATCH_MS)

    expect(pty.write).not.toHaveBeenCalled()
  })

  it('stops when the tab closes or gets another PTY', async () => {
    watch()
    removeTestTab(MAIN, TAB)
    await vi.advanceTimersByTimeAsync(SPOTLIGHT_STRAY_STARTUP_WATCH_MS)

    resetSpotlightTerminalTestStore({
      tabsByWorktree: { [MAIN]: [makeTestTab({ id: TAB, worktreeId: MAIN, ptyId: PTY })] }
    })
    watch()
    bindTestTabPty(MAIN, TAB, 'pty-2')
    await vi.advanceTimersByTimeAsync(SPOTLIGHT_STRAY_STARTUP_WATCH_MS)

    expect(pty.write).not.toHaveBeenCalled()
  })

  it('gives up after the watch window', async () => {
    childRunning = false
    watch()

    await vi.advanceTimersByTimeAsync(SPOTLIGHT_STRAY_STARTUP_WATCH_MS)
    const readings = pty.hasChildProcesses.mock.calls.length
    childRunning = true
    await vi.advanceTimersByTimeAsync(SPOTLIGHT_STRAY_STARTUP_WATCH_MS)

    expect(pty.hasChildProcesses).toHaveBeenCalledTimes(readings)
    expect(pty.write).not.toHaveBeenCalled()
  })
})
