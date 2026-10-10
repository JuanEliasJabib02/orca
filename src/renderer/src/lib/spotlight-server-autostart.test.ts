import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SpotlightServerStartResult } from '../../../shared/spotlight'
import type {
  SpotlightServerConfig,
  SpotlightServerScriptDetection
} from '../../../shared/spotlight-server-types'
import type { Worktree } from '../../../shared/worktree/types'
import type * as SidebarSpaceScopeModule from '@/components/sidebar/sidebar-space-scope'
import {
  bindTestTabPty,
  makeTestSpotlightState,
  makeTestTab,
  makeTestWorktree,
  removeTestTab,
  resetSpotlightTerminalTestStore,
  spotlightTerminalEvents,
  spotlightTerminalTestStore,
  type SpotlightTerminalTestData
} from './spotlight-terminal-test-store'

const mountRequests = vi.hoisted(() => {
  const requests: { pending: unknown; tabIds?: string[] }[] = []
  return requests
})
// Why: the test store has no space state; a set narrows to one space, where the restart must still reach every repo.
const activeSpace = vi.hoisted(() => ({ repoIds: null as ReadonlySet<string> | null }))

vi.mock('@/components/sidebar/sidebar-space-scope', async (importOriginal) => ({
  ...(await importOriginal<typeof SidebarSpaceScopeModule>()),
  resolveSidebarSpaceScopeFromState: () =>
    activeSpace.repoIds
      ? { groupIds: new Set(['work']), repoIds: activeSpace.repoIds, folderWorkspaceIds: new Set() }
      : null
}))

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
  applySpotlightEnvChange,
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
    prepareServerLaunch: vi.fn(
      async (args: { repoId: string; command: string }): Promise<string | null> => {
        spotlightTerminalEvents.push('prepare')
        return args.command
      }
    ),
    cancelPreparedServerLaunch: vi.fn(async (_args: { repoId: string }) => {}),
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

function callOrder(mock: { mock: { invocationCallOrder: number[] } }): number {
  return mock.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY
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

  it('keys a lone workspace by its branch name, the task it forms on its own', async () => {
    const lone = makeTestWorktree({ id: 'admin-lone', repoId: REPO, branch: 'refs/heads/lone-fix' })
    seed({
      worktreesByRepo: { [REPO]: [MAIN, TICKET, lone] },
      spotlightEnvByTaskKey: { 'lone-fix': 'dev' }
    })

    expect(await resolveSpotlightActivationCommand(REPO, lone.id)).toBe('pnpm dev:do --port 3000')
    expect(await resolveSpotlightActivationCommand(REPO, TICKET.id)).toBe('pnpm local --port 3000')
  })

  it('keys a workspace with no usable name by its own id', async () => {
    const unnamed = makeTestWorktree({ id: 'admin-x', repoId: REPO, branch: '', displayName: '' })
    seed({
      worktreesByRepo: { [REPO]: [MAIN, TICKET, unnamed] },
      spotlightEnvByTaskKey: { 'admin-x': 'dev' }
    })

    expect(await resolveSpotlightActivationCommand(REPO, unnamed.id)).toBe(
      'pnpm dev:do --port 3000'
    )
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
    expect(api.spotlight.cancelPreparedServerLaunch).not.toHaveBeenCalled()
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
    // Cancelled first, so the live start chains the install the queued line had taken.
    expect(api.spotlight.cancelPreparedServerLaunch).toHaveBeenCalledWith({ repoId: REPO })
    expect(callOrder(api.spotlight.cancelPreparedServerLaunch)).toBeLessThan(
      callOrder(api.spotlight.startServer)
    )
  })

  it('cancels the prepared line when its tab closes before any pane runs it', async () => {
    await openSpotlightTerminalAndStartServer({ repoId: REPO, worktreeId: TICKET.id })

    removeTestTab(MAIN.id, 'created-1')

    expect(api.spotlight.cancelPreparedServerLaunch).toHaveBeenCalledWith({ repoId: REPO })
    expect(api.spotlight.startServer).not.toHaveBeenCalled()
  })

  it('cancels a prepared line the PTY made useless by binding first, then starts live', async () => {
    seed({
      tabsByWorktree: {
        [MAIN.id]: [makeTestTab({ id: 'spot', worktreeId: MAIN.id, spotlightRepoRoot: true })]
      }
    })
    api.spotlight.prepareServerLaunch.mockImplementationOnce(async (args) => {
      bindTestTabPty(MAIN.id, 'spot', 'pty-2')
      return `pnpm install --frozen-lockfile && ${args.command}`
    })

    const activation = await openSpotlightTerminalAndStartServer({
      repoId: REPO,
      worktreeId: TICKET.id
    })

    expect(activation.opened).toMatchObject({ ok: true, startupQueued: false, ptyId: 'pty-2' })
    expect(spotlightTerminalTestStore.getState().pendingStartupByTabId).toEqual({})
    expect(api.spotlight.cancelPreparedServerLaunch).toHaveBeenCalledWith({ repoId: REPO })
    expect(callOrder(api.spotlight.cancelPreparedServerLaunch)).toBeLessThan(
      callOrder(api.spotlight.startServer)
    )
    expect(activation.server).toEqual({ kind: 'started', command: 'pnpm local --port 3000' })
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
    expect(api.spotlight.cancelPreparedServerLaunch).not.toHaveBeenCalled()
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

  it('stale PTY main proves gone: forgets it, then prepares, queues and mounts a new one', async () => {
    seed({ tabsByWorktree: { [MAIN.id]: [liveSpotlightTab()] } })
    api.spotlight.startServer.mockResolvedValueOnce({ ok: false, reason: 'terminal-gone' })

    const activation = await openSpotlightTerminalAndStartServer({
      repoId: REPO,
      worktreeId: TICKET.id
    })

    expect(api.spotlight.startServer).toHaveBeenCalledTimes(1)
    expect(spotlightTerminalTestStore.getState().clearTabPtyId).toHaveBeenCalledWith(
      'spot',
      'pty-1'
    )
    expect(spotlightTerminalEvents).toEqual(['clearPty', 'prepare', 'queue', 'mount'])
    expect(mountRequests).toEqual([
      { pending: { command: 'pnpm local --port 3000' }, tabIds: ['spot'] }
    ])
    expect(spotlightTerminalTestStore.getState().pendingInitialCwdByTabId).toEqual({
      spot: MAIN.path
    })
    expect(activation.server).toEqual({ kind: 'queued', command: 'pnpm local --port 3000' })
    expect(activation.opened).toMatchObject({ ok: true, ptyId: null, startupQueued: true })
  })

  it('gives up after one respawn when the store keeps the dead PTY', async () => {
    seed({ tabsByWorktree: { [MAIN.id]: [liveSpotlightTab()] } })
    api.spotlight.startServer
      .mockResolvedValueOnce({ ok: false, reason: 'terminal-gone' })
      .mockResolvedValueOnce({ ok: false, reason: 'terminal-gone' })
    spotlightTerminalTestStore.getState().clearTabPtyId.mockImplementation(() => {})

    const activation = await openSpotlightTerminalAndStartServer({
      repoId: REPO,
      worktreeId: TICKET.id
    })

    expect(api.spotlight.startServer).toHaveBeenCalledTimes(2)
    expect(api.spotlight.prepareServerLaunch).not.toHaveBeenCalled()
    expect(mountRequests).toEqual([])
    expect(activation.server).toEqual({ kind: 'none' })
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

describe('applySpotlightEnvChange', () => {
  const BACKEND = 'backend'
  const BE_MAIN = makeTestWorktree({ id: 'backend-main', repoId: BACKEND, isMainWorktree: true })
  const BE_TICKET = makeTestWorktree({
    id: 'backend-ax',
    repoId: BACKEND,
    branch: 'refs/heads/juan/AX-3447-api',
    displayName: 'api'
  })
  const OTHER = makeTestWorktree({
    id: 'admin-other',
    repoId: REPO,
    branch: 'refs/heads/juan/AX-1-other',
    displayName: 'other'
  })
  const LONE = makeTestWorktree({ id: 'admin-lone', repoId: REPO, branch: 'refs/heads/lone-fix' })

  // The task AX-3447 holds the Spotlight of both repos; the backend has no Dev command.
  function seedTask(overrides: Partial<SpotlightTerminalTestData> = {}): void {
    seed({
      repos: [
        { id: REPO, spotlightServer: CONFIG },
        { id: BACKEND, spotlightServer: { local: 'ax-dev-back' } }
      ],
      worktreesByRepo: { [REPO]: [MAIN, TICKET, OTHER, LONE], [BACKEND]: [BE_MAIN, BE_TICKET] },
      spotlightByRepo: {
        [REPO]: makeTestSpotlightState(REPO, TICKET.id),
        [BACKEND]: makeTestSpotlightState(BACKEND, BE_TICKET.id)
      },
      ...overrides
    })
  }

  function startedCommands(): [string, string][] {
    return api.spotlight.startServer.mock.calls.map(([args]): [string, string] => [
      args.repoId,
      args.command
    ])
  }

  it('Dev: restarts the front with its Dev command and keeps the backend, which has none', async () => {
    seedTask({ spotlightEnvByTaskKey: { 'AX-3447': 'dev' } })

    await applySpotlightEnvChange('AX-3447')

    expect(api.spotlight.startServer).toHaveBeenCalledTimes(1)
    expect(api.spotlight.startServer).toHaveBeenCalledWith({
      repoId: REPO,
      command: 'pnpm dev:do --port 3000',
      restartIfDifferent: true
    })
  })

  it('Local: starts every held repo with its Local command', async () => {
    seedTask()

    await applySpotlightEnvChange('AX-3447')

    expect(api.spotlight.startServer).toHaveBeenCalledTimes(2)
    expect(api.spotlight.startServer).toHaveBeenCalledWith({
      repoId: BACKEND,
      command: 'ax-dev-back',
      restartIfDifferent: true
    })
    expect(api.spotlight.startServer).toHaveBeenCalledWith({
      repoId: REPO,
      command: 'pnpm local --port 3000',
      restartIfDifferent: true
    })
  })

  it('leaves a repo whose Spotlight is held by a workspace of another task alone', async () => {
    seedTask({
      spotlightByRepo: {
        [REPO]: makeTestSpotlightState(REPO, OTHER.id),
        [BACKEND]: makeTestSpotlightState(BACKEND, BE_TICKET.id)
      }
    })

    await applySpotlightEnvChange('AX-3447')

    expect(startedCommands()).toEqual([[BACKEND, 'ax-dev-back']])
  })

  it('leaves a repo whose Spotlight is off alone', async () => {
    seedTask({ spotlightByRepo: { [BACKEND]: makeTestSpotlightState(BACKEND, BE_TICKET.id) } })

    await applySpotlightEnvChange('AX-3447')

    expect(startedCommands()).toEqual([[BACKEND, 'ax-dev-back']])
  })

  it('does nothing when no Spotlight is held for the key', async () => {
    seedTask({ spotlightByRepo: {} })

    await applySpotlightEnvChange('AX-3447')

    expect(api.spotlight.startServer).not.toHaveBeenCalled()
  })

  it('applies the environment of a lone workspace through its branch name', async () => {
    seedTask({
      spotlightByRepo: { [REPO]: makeTestSpotlightState(REPO, LONE.id) },
      spotlightEnvByTaskKey: { 'lone-fix': 'dev' }
    })

    await applySpotlightEnvChange('AX-3447')
    expect(api.spotlight.startServer).not.toHaveBeenCalled()

    await applySpotlightEnvChange('lone-fix')
    expect(startedCommands()).toEqual([[REPO, 'pnpm dev:do --port 3000']])
  })

  it('restarts the servers of the same task in every space, whichever one is active', async () => {
    // Why: the env setting is stored per task key, so a space that is not active shows it too.
    activeSpace.repoIds = new Set([BACKEND])
    try {
      seedTask()

      await applySpotlightEnvChange('AX-3447')

      expect(startedCommands()).toHaveLength(2)
      expect(startedCommands()).toEqual(
        expect.arrayContaining([
          [BACKEND, 'ax-dev-back'],
          [REPO, 'pnpm local --port 3000']
        ])
      )
    } finally {
      activeSpace.repoIds = null
    }
  })

  it('treats a branch-name task across repos like the sidebar', async () => {
    const shared = (repoId: string, id: string): Worktree =>
      makeTestWorktree({ id, repoId, branch: 'refs/heads/landing-redo', displayName: 'x' })
    const own = shared(REPO, 'admin-landing')
    seedTask({
      worktreesByRepo: { [REPO]: [MAIN, own], [BACKEND]: [BE_MAIN, shared(BACKEND, 'be-landing')] },
      spotlightByRepo: { [REPO]: makeTestSpotlightState(REPO, own.id) },
      spotlightEnvByTaskKey: { 'landing-redo': 'dev' }
    })

    await applySpotlightEnvChange('landing-redo')

    expect(startedCommands()).toEqual([[REPO, 'pnpm dev:do --port 3000']])
  })

  it('never throws when the start IPC fails, and still starts the other repos', async () => {
    seedTask()
    api.spotlight.startServer.mockRejectedValueOnce(new Error('ipc gone'))

    await expect(applySpotlightEnvChange('AX-3447')).resolves.toBeUndefined()

    expect(api.spotlight.startServer).toHaveBeenCalledTimes(2)
  })

  it('never throws when the store cannot be read', async () => {
    seedTask()
    const getState = vi.spyOn(spotlightTerminalTestStore, 'getState').mockImplementationOnce(() => {
      throw new Error('store gone')
    })

    await expect(applySpotlightEnvChange('AX-3447')).resolves.toBeUndefined()

    expect(api.spotlight.startServer).not.toHaveBeenCalled()
    getState.mockRestore()
  })

  it('leaves a repo untouched when main reports its terminal busy', async () => {
    seedTask({ spotlightEnvByTaskKey: { 'AX-3447': 'dev' } })
    api.spotlight.startServer.mockResolvedValueOnce({ ok: true, started: false, reason: 'busy' })

    await expect(applySpotlightEnvChange('AX-3447')).resolves.toBeUndefined()

    expect(api.spotlight.startServer).toHaveBeenCalledTimes(1)
  })
})
