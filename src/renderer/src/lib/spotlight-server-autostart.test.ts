import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SpotlightServerStartResult } from '../../../shared/spotlight'
import type {
  SpotlightServerConfig,
  SpotlightServerScriptDetection
} from '../../../shared/spotlight-server-types'
import type { Worktree } from '../../../shared/worktree/types'
import {
  bindTestTabPty,
  makeTestSpotlightState,
  makeTestTab,
  makeTestWorktree,
  resetSpotlightTerminalTestStore,
  spotlightTerminalEvents,
  spotlightTerminalTestStore,
  type SpotlightTerminalTestData
} from './spotlight-terminal-test-store'

const mountRequests = vi.hoisted(() => {
  const requests: { pending: unknown; tabIds?: string[] }[] = []
  return requests
})

vi.mock('@/store', async () => {
  const { spotlightTerminalTestStore: store } = await import('./spotlight-terminal-test-store')
  return { useAppStore: store }
})
vi.mock('@/components/tab-bar/reconcile-order', () => ({
  appendTerminalToPersistedTabOrder: vi.fn()
}))
vi.mock('@/lib/worktree-activation', () => ({ activateAndRevealWorktree: vi.fn() }))
vi.mock('@/components/terminal/background-terminal-worktree-mount', async () => {
  const { spotlightTerminalEvents: events, spotlightTerminalTestStore: store } =
    await import('./spotlight-terminal-test-store')
  return {
    requestBackgroundTerminalWorktreeMount: (detail: { worktreeId: string; tabIds?: string[] }) => {
      events.push('mount')
      // What a pane mounting right now would read as its startup command.
      const tabId = detail.tabIds?.[0] ?? ''
      mountRequests.push({
        pending: store.getState().pendingStartupByTabId[tabId],
        tabIds: detail.tabIds
      })
    }
  }
})

import {
  SPOTLIGHT_START_RETRY_DELAY_MS,
  openSpotlightTerminalAndStartServer,
  resolveSpotlightActivationCommand
} from './spotlight-server-autostart'

const REPO = 'admin'
const MAIN = makeTestWorktree({ id: 'admin-main', repoId: REPO, isMainWorktree: true })
const TICKET = makeTestWorktree({
  id: 'admin-ax',
  repoId: REPO,
  branch: 'refs/heads/juan/AX-3447-checkout',
  displayName: 'checkout'
})
const CONFIG: SpotlightServerConfig = { local: 'pnpm local', dev: 'pnpm dev:do', port: 3000 }

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
    prepareServerLaunch: vi.fn(async (args: { repoId: string; command: string }) => {
      spotlightTerminalEvents.push('prepare')
      return args.command
    }),
    startServer: vi.fn(
      async (_args: {
        repoId: string
        command: string
        restartIfDifferent?: boolean
      }): Promise<SpotlightServerStartResult> => ({ ok: true, started: true })
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

function liveSpotlightTab(): ReturnType<typeof makeTestTab> {
  return makeTestTab({ id: 'spot', worktreeId: MAIN.id, ptyId: 'pty-1', spotlightRepoRoot: true })
}

beforeEach(() => {
  vi.clearAllMocks()
  mountRequests.length = 0
  seed()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('resolveSpotlightActivationCommand', () => {
  it('uses the environment chosen for the worktree task', async () => {
    seed({ spotlightEnvByTaskKey: { 'AX-3447': 'dev' } })

    expect(await resolveSpotlightActivationCommand(REPO, TICKET.id)).toBe('pnpm dev:do --port 3000')
  })

  it('defaults to Local', async () => {
    expect(await resolveSpotlightActivationCommand(REPO, TICKET.id)).toBe('pnpm local --port 3000')
  })

  it('runs the Dev command locally when there is no Local one', async () => {
    seed({ repos: [{ id: REPO, spotlightServer: { dev: 'pnpm dev:do' } }] })

    expect(await resolveSpotlightActivationCommand(REPO, TICKET.id)).toBe('pnpm dev:do')
  })

  it('falls back to detected scripts', async () => {
    seed({ repos: [{ id: REPO }] })
    api.repos.detectSpotlightServerScripts.mockResolvedValueOnce({
      detected: { local: 'pnpm local' },
      scriptCommands: []
    })

    expect(await resolveSpotlightActivationCommand(REPO, TICKET.id)).toBe('pnpm local')
  })

  it('returns null when the repo is not started in that environment', async () => {
    seed({
      repos: [{ id: REPO, spotlightServer: { local: 'ax-dev-back' } }],
      spotlightEnvByTaskKey: { 'AX-3447': 'dev' }
    })

    expect(await resolveSpotlightActivationCommand(REPO, TICKET.id)).toBeNull()
  })

  it('keys a branch-name task across repos, like the sidebar', async () => {
    const shared = (repoId: string, id: string): Worktree =>
      makeTestWorktree({ id, repoId, branch: 'refs/heads/landing-redo', displayName: 'x' })
    const own = shared(REPO, 'admin-landing')
    seed({
      worktreesByRepo: { [REPO]: [MAIN, own], backend: [shared('backend', 'backend-landing')] },
      spotlightEnvByTaskKey: { 'landing-redo': 'dev' }
    })

    expect(await resolveSpotlightActivationCommand(REPO, own.id)).toBe('pnpm dev:do --port 3000')
  })

  it('still resolves from config when detection fails', async () => {
    api.repos.detectSpotlightServerScripts.mockRejectedValueOnce(new Error('ipc gone'))

    expect(await resolveSpotlightActivationCommand(REPO, TICKET.id)).toBe('pnpm local --port 3000')
  })
})

describe('openSpotlightTerminalAndStartServer', () => {
  it('starts nothing without a command, but still opens the terminal', async () => {
    seed({ repos: [{ id: REPO }] })

    const activation = await openSpotlightTerminalAndStartServer({
      repoId: REPO,
      worktreeId: TICKET.id
    })

    expect(activation.server).toEqual({ kind: 'none' })
    expect(activation.opened).toMatchObject({ ok: true, startupQueued: false })
    expect(api.spotlight.prepareServerLaunch).not.toHaveBeenCalled()
    expect(api.spotlight.startServer).not.toHaveBeenCalled()
    expect(mountRequests).toEqual([])
  })

  it('new tab: prepares, then creates and queues, then mounts it in the background', async () => {
    const activation = await openSpotlightTerminalAndStartServer({
      repoId: REPO,
      worktreeId: TICKET.id
    })

    expect(spotlightTerminalEvents).toEqual(['prepare', 'createTab', 'queue', 'mount'])
    expect(mountRequests).toEqual([
      { pending: { command: 'pnpm local --port 3000' }, tabIds: ['created-1'] }
    ])
    expect(activation.server).toEqual({ kind: 'queued', command: 'pnpm local --port 3000' })
    expect(api.spotlight.startServer).not.toHaveBeenCalled()
  })

  it('queues the launch line main returns, install prefix included', async () => {
    api.spotlight.prepareServerLaunch.mockResolvedValueOnce(
      'pnpm install --frozen-lockfile && pnpm local --port 3000'
    )

    await openSpotlightTerminalAndStartServer({ repoId: REPO, worktreeId: TICKET.id })

    expect(mountRequests[0]?.pending).toEqual({
      command: 'pnpm install --frozen-lockfile && pnpm local --port 3000'
    })
  })

  it('dead PTY: queues on the existing Spotlight tab and mounts it', async () => {
    seed({
      tabsByWorktree: {
        [MAIN.id]: [makeTestTab({ id: 'spot', worktreeId: MAIN.id, spotlightRepoRoot: true })]
      }
    })

    const activation = await openSpotlightTerminalAndStartServer({
      repoId: REPO,
      worktreeId: TICKET.id
    })

    expect(spotlightTerminalEvents).toEqual(['prepare', 'queue', 'mount'])
    expect(mountRequests).toEqual([
      { pending: { command: 'pnpm local --port 3000' }, tabIds: ['spot'] }
    ])
    expect(activation.server.kind).toBe('queued')
  })

  it('starts nothing when main refuses the launch', async () => {
    api.spotlight.prepareServerLaunch.mockResolvedValueOnce(null)

    const activation = await openSpotlightTerminalAndStartServer({
      repoId: REPO,
      worktreeId: TICKET.id
    })

    expect(activation.server).toEqual({ kind: 'none' })
    expect(activation.opened).toMatchObject({ ok: true, startupQueued: false })
    expect(mountRequests).toEqual([])
  })

  it('falls back to a live start when a pane mounted earlier never reads the queue', async () => {
    seed({
      tabsByWorktree: {
        [MAIN.id]: [makeTestTab({ id: 'spot', worktreeId: MAIN.id, spotlightRepoRoot: true })]
      }
    })
    await openSpotlightTerminalAndStartServer({ repoId: REPO, worktreeId: TICKET.id })

    bindTestTabPty(MAIN.id, 'spot', 'pty-2')

    await vi.waitFor(() =>
      expect(api.spotlight.startServer).toHaveBeenCalledWith({
        repoId: REPO,
        command: 'pnpm local --port 3000',
        restartIfDifferent: true
      })
    )
    expect(spotlightTerminalTestStore.getState().pendingStartupByTabId).toEqual({})
  })

  it('live PTY: waits for the log mirror, then asks main to start it', async () => {
    seed({ tabsByWorktree: { [MAIN.id]: [liveSpotlightTab()] } })
    let finishRegistration: () => void = () => {}
    api.spotlight.setLogPty.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishRegistration = resolve
        })
    )

    const activating = openSpotlightTerminalAndStartServer({ repoId: REPO, worktreeId: TICKET.id })
    await vi.waitFor(() => expect(api.spotlight.setLogPty).toHaveBeenCalled())
    expect(api.spotlight.startServer).not.toHaveBeenCalled()
    finishRegistration()
    const activation = await activating

    expect(api.spotlight.prepareServerLaunch).not.toHaveBeenCalled()
    expect(api.spotlight.startServer).toHaveBeenCalledWith({
      repoId: REPO,
      command: 'pnpm local --port 3000',
      restartIfDifferent: true
    })
    expect(activation.server).toEqual({ kind: 'started', command: 'pnpm local --port 3000' })
    expect(spotlightTerminalTestStore.getState().pendingStartupByTabId).toEqual({})
  })

  it('reports a takeover restart', async () => {
    seed({ tabsByWorktree: { [MAIN.id]: [liveSpotlightTab()] } })
    api.spotlight.startServer.mockResolvedValueOnce({ ok: true, started: true, restarted: true })

    const activation = await openSpotlightTerminalAndStartServer({
      repoId: REPO,
      worktreeId: TICKET.id
    })

    expect(activation.server).toEqual({ kind: 'restarted', command: 'pnpm local --port 3000' })
  })

  it('reports nothing started for a busy terminal', async () => {
    seed({ tabsByWorktree: { [MAIN.id]: [liveSpotlightTab()] } })
    api.spotlight.startServer.mockResolvedValueOnce({ ok: true, started: false, reason: 'busy' })

    const activation = await openSpotlightTerminalAndStartServer({
      repoId: REPO,
      worktreeId: TICKET.id
    })

    expect(activation.server).toEqual({ kind: 'none' })
  })

  it('retries while main is still registering the terminal', async () => {
    vi.useFakeTimers()
    seed({ tabsByWorktree: { [MAIN.id]: [liveSpotlightTab()] } })
    api.spotlight.startServer.mockResolvedValueOnce({ ok: false, reason: 'no-terminal' })

    const activating = openSpotlightTerminalAndStartServer({ repoId: REPO, worktreeId: TICKET.id })
    await vi.advanceTimersByTimeAsync(SPOTLIGHT_START_RETRY_DELAY_MS)

    expect((await activating).server.kind).toBe('started')
    expect(api.spotlight.startServer).toHaveBeenCalledTimes(2)
  })

  it('never throws when the start IPC fails', async () => {
    seed({ tabsByWorktree: { [MAIN.id]: [liveSpotlightTab()] } })
    api.spotlight.startServer.mockRejectedValueOnce(new Error('ipc gone'))

    const activation = await openSpotlightTerminalAndStartServer({
      repoId: REPO,
      worktreeId: TICKET.id
    })

    expect(activation).toMatchObject({ opened: { ok: true }, server: { kind: 'none' } })
  })

  it('never throws when the prepare IPC fails', async () => {
    api.spotlight.prepareServerLaunch.mockRejectedValueOnce(new Error('ipc gone'))

    const activation = await openSpotlightTerminalAndStartServer({
      repoId: REPO,
      worktreeId: TICKET.id
    })

    expect(activation).toMatchObject({ opened: { ok: true }, server: { kind: 'none' } })
  })
})
