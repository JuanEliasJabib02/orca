import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  makeTestTab,
  makeTestWorktree,
  resetSpotlightTerminalTestStore,
  spotlightTerminalTestStore
} from './spotlight-terminal-test-store'

vi.mock('@/store', async () => {
  const { spotlightTerminalTestStore: store } = await import('./spotlight-terminal-test-store')
  return { useAppStore: store }
})
vi.mock('@/components/tab-bar/reconcile-order', () => ({
  appendTerminalToPersistedTabOrder: vi.fn()
}))
vi.mock('@/lib/worktree-activation', () => ({ activateAndRevealWorktree: vi.fn() }))

import { openSpotlightTerminalTab, planSpotlightTerminal } from './open-spotlight-terminal-tab'

const REPO = 'repo-1'
const MAIN = makeTestWorktree({ id: 'main', repoId: REPO, isMainWorktree: true, path: '/root' })
const FEATURE = makeTestWorktree({ id: 'feature', repoId: REPO })

const setLogPty = vi.fn(async (_args: { repoId: string; ptyId: string }) => {})
// @ts-expect-error test window mock
globalThis.window = { api: { spotlight: { setLogPty } } }

function seed(tabs: ReturnType<typeof makeTestTab>[], activeTabId: string | null = null): void {
  resetSpotlightTerminalTestStore({
    worktreesByRepo: { [REPO]: [MAIN, FEATURE] },
    tabsByWorktree: { [MAIN.id]: tabs },
    activeTabIdByWorktree: { [MAIN.id]: activeTabId }
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  seed([])
})

describe('planSpotlightTerminal', () => {
  it('needs a main worktree', () => {
    resetSpotlightTerminalTestStore({ worktreesByRepo: { [REPO]: [FEATURE] } })

    expect(planSpotlightTerminal(spotlightTerminalTestStore.getState(), REPO)).toEqual({
      kind: 'no-main-worktree'
    })
  })

  it('reuses the Spotlight tab and reports its PTY', () => {
    seed([
      makeTestTab({ id: 'plain', worktreeId: MAIN.id, ptyId: 'pty-plain' }),
      makeTestTab({ id: 'spot', worktreeId: MAIN.id, ptyId: null, spotlightRepoRoot: true })
    ])

    expect(planSpotlightTerminal(spotlightTerminalTestStore.getState(), REPO)).toEqual({
      kind: 'existing',
      worktreeId: MAIN.id,
      rootPath: '/root',
      tabId: 'spot',
      ptyId: null
    })
  })

  it('adopts the active plain terminal, never an agent tab', () => {
    seed(
      [
        makeTestTab({ id: 'agent', worktreeId: MAIN.id, ptyId: 'pty-a', launchAgent: 'claude' }),
        makeTestTab({ id: 'shell', worktreeId: MAIN.id, ptyId: 'pty-s' })
      ],
      'agent'
    )

    expect(planSpotlightTerminal(spotlightTerminalTestStore.getState(), REPO)).toMatchObject({
      kind: 'adopt',
      tabId: 'shell',
      ptyId: 'pty-s'
    })
  })

  it('creates a tab when nothing fits', () => {
    seed([makeTestTab({ id: 'agent', worktreeId: MAIN.id, launchAgent: 'claude' })])

    expect(planSpotlightTerminal(spotlightTerminalTestStore.getState(), REPO)).toEqual({
      kind: 'create',
      worktreeId: MAIN.id,
      rootPath: '/root',
      ptyId: null
    })
  })
})

describe('openSpotlightTerminalTab with a startup command', () => {
  it('queues the command on a new tab right after creating it', () => {
    const opened = openSpotlightTerminalTab({
      repoId: REPO,
      reveal: false,
      startupCommand: 'pnpm local'
    })

    const state = spotlightTerminalTestStore.getState()
    expect(opened).toMatchObject({
      ok: true,
      worktreeId: MAIN.id,
      tabId: 'created-1',
      ptyId: null,
      startupQueued: true
    })
    expect(state.createTab).toHaveBeenCalledWith(MAIN.id, undefined, undefined, {
      spotlightRepoRoot: true
    })
    expect(state.pendingStartupByTabId['created-1']).toEqual({ command: 'pnpm local' })
    expect(state.pendingInitialCwdByTabId['created-1']).toBe('/root')
    expect(setLogPty).not.toHaveBeenCalled()
  })

  it('queues the command and the root cwd on a Spotlight tab whose PTY died', () => {
    seed([makeTestTab({ id: 'spot', worktreeId: MAIN.id, ptyId: null, spotlightRepoRoot: true })])

    const opened = openSpotlightTerminalTab({ repoId: REPO, reveal: false, startupCommand: 'x' })

    const state = spotlightTerminalTestStore.getState()
    expect(opened).toMatchObject({ ok: true, tabId: 'spot', startupQueued: true })
    expect(state.createTab).not.toHaveBeenCalled()
    expect(state.pendingStartupByTabId.spot).toEqual({ command: 'x' })
    expect(state.pendingInitialCwdByTabId.spot).toBe('/root')
  })

  it('never queues on a live PTY; registers the log mirror instead', async () => {
    seed([
      makeTestTab({ id: 'spot', worktreeId: MAIN.id, ptyId: 'pty-1', spotlightRepoRoot: true })
    ])
    let finishRegistration: () => void = () => {}
    setLogPty.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishRegistration = resolve
        })
    )

    const opened = openSpotlightTerminalTab({ repoId: REPO, reveal: false, startupCommand: 'x' })
    if (!opened.ok) {
      throw new Error('expected the Spotlight tab')
    }
    let registered = false
    void opened.logPtyRegistered.then(() => {
      registered = true
    })
    await Promise.resolve()

    expect(opened.startupQueued).toBe(false)
    expect(opened.ptyId).toBe('pty-1')
    expect(spotlightTerminalTestStore.getState().pendingStartupByTabId).toEqual({})
    expect(setLogPty).toHaveBeenCalledWith({ repoId: REPO, ptyId: 'pty-1' })
    expect(registered).toBe(false)
    finishRegistration()
    await vi.waitFor(() => expect(registered).toBe(true))
  })

  it('adopts a live plain terminal: marks it, mirrors it, queues nothing', () => {
    seed([makeTestTab({ id: 'shell', worktreeId: MAIN.id, ptyId: 'pty-s' })], 'shell')

    const opened = openSpotlightTerminalTab({ repoId: REPO, reveal: false, startupCommand: 'x' })

    const state = spotlightTerminalTestStore.getState()
    expect(opened).toMatchObject({ ok: true, tabId: 'shell', startupQueued: false })
    expect(state.markTabSpotlightRepoRoot).toHaveBeenCalledWith('shell')
    expect(state.tabsByWorktree[MAIN.id]?.[0]?.spotlightRepoRoot).toBe(true)
    expect(setLogPty).toHaveBeenCalledWith({ repoId: REPO, ptyId: 'pty-s' })
    expect(state.pendingStartupByTabId).toEqual({})
  })

  it('queues nothing without a startup command', () => {
    const opened = openSpotlightTerminalTab({ repoId: REPO, reveal: false })

    expect(opened).toMatchObject({ ok: true, startupQueued: false })
    expect(spotlightTerminalTestStore.getState().pendingStartupByTabId).toEqual({})
  })

  it('reports a missing main worktree', () => {
    resetSpotlightTerminalTestStore({ worktreesByRepo: { [REPO]: [FEATURE] } })

    expect(openSpotlightTerminalTab({ repoId: REPO, reveal: false, startupCommand: 'x' })).toEqual({
      ok: false,
      reason: 'no-main-worktree'
    })
  })
})
