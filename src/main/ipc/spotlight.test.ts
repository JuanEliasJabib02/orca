import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, args: unknown) => unknown>(),
  getState: vi.fn<(repoId: string) => unknown>(),
  prepareSpotlightServerLaunch: vi.fn<(repoId: string, command: string) => string | null>(),
  startSpotlightServer: vi.fn(async (_args: unknown) => ({ ok: true, started: true }))
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (event: unknown, args: unknown) => unknown) =>
      mocks.handlers.set(channel, handler),
    removeHandler: (channel: string) => mocks.handlers.delete(channel)
  }
}))

vi.mock('../spotlight/spotlight-service', () => ({
  SpotlightService: class {
    getState = mocks.getState
    reconcileAll = async (): Promise<void> => {}
  }
}))

vi.mock('../spotlight/spotlight-log-mirror', () => ({
  startSpotlightLogCapture: vi.fn(),
  stopSpotlightLogCapture: vi.fn()
}))

vi.mock('../spotlight/spotlight-server-control', () => ({
  prepareSpotlightServerLaunch: mocks.prepareSpotlightServerLaunch,
  restartSpotlightServer: vi.fn(),
  startSpotlightServer: mocks.startSpotlightServer
}))

import { registerSpotlightHandlers } from './spotlight'

const LOCAL_REPO = { id: 'repo-local', path: '/repo-local' }
const SSH_REPO = { id: 'repo-ssh', path: '/repo-ssh', connectionId: 'ssh-1' }
const REPOS = new Map<string, object>([
  [LOCAL_REPO.id, LOCAL_REPO],
  [SSH_REPO.id, SSH_REPO]
])

function invoke(channel: string, args: unknown): unknown {
  const handler = mocks.handlers.get(channel)
  if (!handler) {
    throw new Error(`no handler for ${channel}`)
  }
  return handler({}, args)
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getState.mockReturnValue({ holderWorktreeId: 'wt-1' })
  mocks.prepareSpotlightServerLaunch.mockReturnValue('pnpm local')
  const store = { getRepo: (repoId: string) => REPOS.get(repoId) }
  // @ts-expect-error minimal window and store fakes; the handlers only read these members
  registerSpotlightHandlers({ isDestroyed: () => false }, store)
})

describe('spotlight:prepareServerLaunch', () => {
  it('returns the startup line for an active local Spotlight', () => {
    expect(
      invoke('spotlight:prepareServerLaunch', { repoId: LOCAL_REPO.id, command: 'pnpm local' })
    ).toBe('pnpm local')
    expect(mocks.prepareSpotlightServerLaunch).toHaveBeenCalledWith(LOCAL_REPO.id, 'pnpm local')
  })

  it('refuses while Spotlight is off for the repo', () => {
    mocks.getState.mockReturnValue(null)

    expect(
      invoke('spotlight:prepareServerLaunch', { repoId: LOCAL_REPO.id, command: 'pnpm local' })
    ).toBeNull()
    expect(mocks.prepareSpotlightServerLaunch).not.toHaveBeenCalled()
  })

  it('refuses SSH and unknown repos', () => {
    expect(
      invoke('spotlight:prepareServerLaunch', { repoId: SSH_REPO.id, command: 'pnpm local' })
    ).toBeNull()
    expect(
      invoke('spotlight:prepareServerLaunch', { repoId: 'missing', command: 'pnpm local' })
    ).toBeNull()
    expect(mocks.prepareSpotlightServerLaunch).not.toHaveBeenCalled()
  })
})

describe('spotlight:startServer', () => {
  it('passes restartIfDifferent through only when it is exactly true', async () => {
    await invoke('spotlight:startServer', {
      repoId: LOCAL_REPO.id,
      command: 'pnpm dev',
      restartIfDifferent: true
    })
    await invoke('spotlight:startServer', {
      repoId: LOCAL_REPO.id,
      command: 'pnpm dev',
      restartIfDifferent: 'yes'
    })

    expect(mocks.startSpotlightServer.mock.calls).toEqual([
      [{ repoId: LOCAL_REPO.id, command: 'pnpm dev', restartIfDifferent: true }],
      [{ repoId: LOCAL_REPO.id, command: 'pnpm dev', restartIfDifferent: false }]
    ])
  })

  it('reports not-active while Spotlight is off', async () => {
    mocks.getState.mockReturnValue(null)

    expect(
      await invoke('spotlight:startServer', { repoId: LOCAL_REPO.id, command: 'pnpm dev' })
    ).toEqual({ ok: false, reason: 'not-active' })
    expect(mocks.startSpotlightServer).not.toHaveBeenCalled()
  })
})
