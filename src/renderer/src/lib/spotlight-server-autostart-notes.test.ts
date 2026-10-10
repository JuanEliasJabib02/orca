// Every renderer-side autostart decision reaches main as one note for the repo's Spotlight log; the
// starts main decides itself (started, busy, unreadable, gone) are noted there, not here.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SpotlightServerStartResult } from '../../../shared/spotlight'
import type { SpotlightAutostartNote } from '../../../shared/spotlight-autostart-note'
import type {
  SpotlightServerConfig,
  SpotlightServerScriptDetection
} from '../../../shared/spotlight-server-types'
import {
  bindTestTabPty,
  makeTestSpotlightState,
  makeTestTab,
  makeTestWorktree,
  removeTestTab,
  resetSpotlightTerminalTestStore,
  spotlightTerminalTestStore,
  type SpotlightTerminalTestData
} from './spotlight-terminal-test-store'

vi.mock('@/store', async () => {
  const { spotlightTerminalTestStore: store } = await import('./spotlight-terminal-test-store')
  return { useAppStore: store }
})
vi.mock('@/components/tab-bar/reconcile-order', () => ({
  appendTerminalToPersistedTabOrder: vi.fn()
}))
vi.mock('@/lib/worktree-activation', () => ({ activateAndRevealWorktree: vi.fn() }))
vi.mock('@/components/terminal/background-terminal-worktree-mount', () => ({
  requestBackgroundTerminalWorktreeMount: vi.fn()
}))

import {
  SPOTLIGHT_START_RETRY_DELAY_MS,
  openSpotlightTerminalAndStartServer
} from './spotlight-server-autostart'
import { logSpotlightActivationWithoutCommand } from './spotlight-autostart-log'
import { SPOTLIGHT_STARTUP_CLAIM_TIMEOUT_MS } from './spotlight-startup-claim-watch'

const REPO = 'reset'
const MAIN = makeTestWorktree({ id: 'reset-main', repoId: REPO, isMainWorktree: true })
const TICKET = makeTestWorktree({
  id: 'reset-ax',
  repoId: REPO,
  branch: 'refs/heads/juan/AX-3447-reset',
  displayName: 'reset'
})
const CONFIG: SpotlightServerConfig = { local: 'pnpm local', port: 3002 }
const START_ATTEMPTS = 5

const api = {
  repos: {
    detectSpotlightServerScripts: vi.fn(
      async (_args: { repoId: string }): Promise<SpotlightServerScriptDetection> => ({
        detected: {},
        scriptCommands: []
      })
    )
  },
  spotlight: {
    setLogPty: vi.fn(async (_args: { repoId: string; ptyId: string }) => {}),
    prepareServerLaunch: vi.fn(
      async (args: { repoId: string; command: string }): Promise<string | null> => args.command
    ),
    cancelPreparedServerLaunch: vi.fn(async (_args: { repoId: string }) => {}),
    startServer: vi.fn(
      async (_args: {
        repoId: string
        command: string
        restartIfDifferent?: boolean
      }): Promise<SpotlightServerStartResult> => ({ ok: true, started: true })
    ),
    noteServerAutostart: vi.fn(
      async (_args: { repoId: string; note: SpotlightAutostartNote }) => {}
    )
  }
}
// @ts-expect-error test window mock
globalThis.window = { api }

function seed(overrides: Partial<SpotlightTerminalTestData> = {}): void {
  resetSpotlightTerminalTestStore({
    repos: [{ id: REPO, spotlightServer: CONFIG }],
    worktreesByRepo: { [REPO]: [MAIN, TICKET] },
    spotlightByRepo: { [REPO]: makeTestSpotlightState(REPO, TICKET.id) },
    ...overrides
  })
}

function notes(): SpotlightAutostartNote[] {
  return api.spotlight.noteServerAutostart.mock.calls.map(([args]) => args.note)
}

function liveSpotlightTab(): ReturnType<typeof makeTestTab> {
  return makeTestTab({ id: 'spot', worktreeId: MAIN.id, ptyId: 'pty-1', spotlightRepoRoot: true })
}

function activate(): ReturnType<typeof openSpotlightTerminalAndStartServer> {
  return openSpotlightTerminalAndStartServer({ repoId: REPO, worktreeId: TICKET.id })
}

beforeEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
  seed()
})

describe('an activation that runs no command', () => {
  it('notes the environment it has no command for', async () => {
    seed({ spotlightEnvByTaskKey: { 'AX-3447': 'prod' } })

    await activate()

    expect(notes()).toEqual([{ kind: 'no-command', env: 'prod' }])
  })

  it('notes why for each plan that runs nothing, and a plan that failed', () => {
    logSpotlightActivationWithoutCommand(REPO, { kind: 'ask-variant', candidates: ['do'] })
    logSpotlightActivationWithoutCommand(REPO, { kind: 'none', env: null })
    logSpotlightActivationWithoutCommand(REPO, null)

    expect(notes()).toEqual([
      { kind: 'needs-variant', asked: true },
      { kind: 'needs-variant', asked: false },
      { kind: 'plan-failed' }
    ])
  })
})

describe('a Spotlight terminal that must spawn', () => {
  it('notes the queued line, then its start once the new pane spawns with it', async () => {
    await activate()
    expect(notes()).toEqual([{ kind: 'queued' }])

    const store = spotlightTerminalTestStore.getState()
    const pending = store.pendingStartupByTabId['created-1']
    // What a pane does: binds its new PTY and spends the startup line in the same call.
    bindTestTabPty(MAIN.id, 'created-1', 'pty-2')
    store.consumeTabStartupCommand('created-1', pending)

    await vi.waitFor(() =>
      expect(notes()).toEqual([{ kind: 'queued' }, { kind: 'queued-started' }])
    )
    expect(api.spotlight.startServer).not.toHaveBeenCalled()
  })

  it('notes the queued line dropped when its tab closes first', async () => {
    await activate()

    removeTestTab(MAIN.id, 'created-1')

    expect(notes()).toEqual([{ kind: 'queued' }, { kind: 'queued-dropped', reason: 'tab-closed' }])
  })

  it('notes the queued line dropped when its terminal never spawns', async () => {
    vi.useFakeTimers()
    await activate()

    await vi.advanceTimersByTimeAsync(SPOTLIGHT_STARTUP_CLAIM_TIMEOUT_MS)

    expect(notes()).toEqual([{ kind: 'queued' }, { kind: 'queued-dropped', reason: 'timeout' }])
  })

  it('leaves the note to main when a pane that never read the queue gets a live start', async () => {
    seed({
      tabsByWorktree: {
        [MAIN.id]: [makeTestTab({ id: 'spot', worktreeId: MAIN.id, spotlightRepoRoot: true })]
      }
    })
    await activate()

    bindTestTabPty(MAIN.id, 'spot', 'pty-2')

    await vi.waitFor(() => expect(api.spotlight.startServer).toHaveBeenCalled())
    expect(notes()).toEqual([{ kind: 'queued' }])
  })

  it('notes a prepare main refused', async () => {
    api.spotlight.prepareServerLaunch.mockResolvedValueOnce(null)

    await activate()

    expect(notes()).toEqual([{ kind: 'prepare-failed', refused: true }])
  })

  it('notes a prepare request that failed', async () => {
    api.spotlight.prepareServerLaunch.mockRejectedValueOnce(new Error('ipc gone'))

    await activate()

    expect(notes()).toEqual([{ kind: 'prepare-failed', refused: false }])
  })
})

describe('a live Spotlight terminal', () => {
  beforeEach(() => {
    seed({ tabsByWorktree: { [MAIN.id]: [liveSpotlightTab()] } })
  })

  it('notes nothing itself for the starts main decides', async () => {
    api.spotlight.startServer.mockResolvedValueOnce({ ok: true, started: false, reason: 'busy' })
    await activate()
    await activate()

    expect(notes()).toEqual([])
  })

  it('notes a start main refused because Spotlight is no longer active', async () => {
    api.spotlight.startServer.mockResolvedValueOnce({ ok: false, reason: 'not-active' })

    await activate()

    expect(notes()).toEqual([{ kind: 'start-failed', reason: 'not-active' }])
  })

  it('notes once, after its retries, a terminal main never registered', async () => {
    vi.useFakeTimers()
    api.spotlight.startServer.mockResolvedValue({ ok: false, reason: 'no-terminal' })

    const activating = activate()
    await vi.advanceTimersByTimeAsync(SPOTLIGHT_START_RETRY_DELAY_MS * START_ATTEMPTS)
    await activating

    expect(api.spotlight.startServer).toHaveBeenCalledTimes(START_ATTEMPTS)
    expect(notes()).toEqual([{ kind: 'start-failed', reason: 'no-terminal' }])
  })

  it('notes a start request that failed', async () => {
    api.spotlight.startServer.mockRejectedValueOnce(new Error('ipc gone'))

    await activate()

    expect(notes()).toEqual([{ kind: 'start-failed', reason: 'error' }])
  })

  it('notes the respawn of a PTY main proved gone, which main noted itself', async () => {
    api.spotlight.startServer.mockResolvedValueOnce({ ok: false, reason: 'terminal-gone' })

    await activate()

    expect(notes()).toEqual([{ kind: 'queued' }])
  })
})

it('never breaks the autostart when the note IPC is missing or fails', async () => {
  api.spotlight.noteServerAutostart.mockRejectedValueOnce(new Error('ipc gone'))
  seed({ spotlightEnvByTaskKey: { 'AX-3447': 'dev' } })

  expect((await activate()).server).toEqual({ kind: 'none' })
})
