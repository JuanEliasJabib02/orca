import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, args: unknown) => unknown>(),
  getState: vi.fn<(repoId: string) => unknown>(),
  prepareSpotlightServerLaunch:
    vi.fn<(repoId: string, command: string) => Promise<string | null>>(),
  cancelPreparedSpotlightServerLaunch: vi.fn<(repoId: string) => void>(),
  markPreparedSpotlightLaunchRegistered: vi.fn<(repoId: string) => void>(),
  startSpotlightLogCapture: vi.fn(async (_args: unknown) => {}),
  stopSpotlightLogCapture: vi.fn<(args: { repoId: string; ptyId?: string }) => void>(),
  watchLateSpotlightTerminal: vi.fn<(repoId: string, ptyId: string) => void>(),
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
  startSpotlightLogCapture: mocks.startSpotlightLogCapture,
  stopSpotlightLogCapture: mocks.stopSpotlightLogCapture
}))

vi.mock('../spotlight/spotlight-server-commands', () => ({
  markPreparedSpotlightLaunchRegistered: mocks.markPreparedSpotlightLaunchRegistered
}))

vi.mock('../spotlight/spotlight-server-control', () => ({
  cancelPreparedSpotlightServerLaunch: mocks.cancelPreparedSpotlightServerLaunch,
  prepareSpotlightServerLaunch: mocks.prepareSpotlightServerLaunch,
  startSpotlightServer: mocks.startSpotlightServer,
  watchLateSpotlightTerminal: mocks.watchLateSpotlightTerminal
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
  mocks.prepareSpotlightServerLaunch.mockResolvedValue('pnpm local')
  const store = { getRepo: (repoId: string) => REPOS.get(repoId) }
  // @ts-expect-error minimal window and store fakes; the handlers only read these members
  registerSpotlightHandlers({ isDestroyed: () => false }, store)
})

describe('spotlight:prepareServerLaunch', () => {
  it('returns the startup line for an active local Spotlight', async () => {
    expect(
      await invoke('spotlight:prepareServerLaunch', {
        repoId: LOCAL_REPO.id,
        command: 'pnpm local'
      })
    ).toBe('pnpm local')
    expect(mocks.prepareSpotlightServerLaunch).toHaveBeenCalledWith(LOCAL_REPO.id, 'pnpm local')
  })

  it('refuses while Spotlight is off for the repo', async () => {
    mocks.getState.mockReturnValue(null)

    expect(
      await invoke('spotlight:prepareServerLaunch', {
        repoId: LOCAL_REPO.id,
        command: 'pnpm local'
      })
    ).toBeNull()
    expect(mocks.prepareSpotlightServerLaunch).not.toHaveBeenCalled()
  })

  it('refuses SSH and unknown repos', async () => {
    expect(
      await invoke('spotlight:prepareServerLaunch', { repoId: SSH_REPO.id, command: 'pnpm local' })
    ).toBeNull()
    expect(
      await invoke('spotlight:prepareServerLaunch', { repoId: 'missing', command: 'pnpm local' })
    ).toBeNull()
    expect(mocks.prepareSpotlightServerLaunch).not.toHaveBeenCalled()
  })
})

describe('spotlight:cancelPreparedServerLaunch', () => {
  it('takes back the prepared line of an active local Spotlight', () => {
    invoke('spotlight:cancelPreparedServerLaunch', { repoId: LOCAL_REPO.id })

    expect(mocks.cancelPreparedSpotlightServerLaunch).toHaveBeenCalledWith(LOCAL_REPO.id)
  })

  it('does nothing while Spotlight is off, or for SSH and unknown repos', () => {
    invoke('spotlight:cancelPreparedServerLaunch', { repoId: SSH_REPO.id })
    invoke('spotlight:cancelPreparedServerLaunch', { repoId: 'missing' })
    mocks.getState.mockReturnValue(null)
    invoke('spotlight:cancelPreparedServerLaunch', { repoId: LOCAL_REPO.id })

    expect(mocks.cancelPreparedSpotlightServerLaunch).not.toHaveBeenCalled()
  })
})

describe('spotlight:setLogPty', () => {
  it('marks a queued server launch as having a shell, once the capture is registered', async () => {
    await invoke('spotlight:setLogPty', { repoId: LOCAL_REPO.id, ptyId: 'pty-1' })

    expect(mocks.startSpotlightLogCapture).toHaveBeenCalledWith({
      repoId: LOCAL_REPO.id,
      ptyId: 'pty-1',
      rootPath: LOCAL_REPO.path
    })
    expect(mocks.markPreparedSpotlightLaunchRegistered).toHaveBeenCalledWith(LOCAL_REPO.id)
    expect(mocks.startSpotlightLogCapture.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.markPreparedSpotlightLaunchRegistered.mock.invocationCallOrder[0] ?? 0
    )
  })

  it('does nothing while Spotlight is off', async () => {
    mocks.getState.mockReturnValue(null)

    await invoke('spotlight:setLogPty', { repoId: LOCAL_REPO.id, ptyId: 'pty-1' })

    expect(mocks.startSpotlightLogCapture).not.toHaveBeenCalled()
    expect(mocks.markPreparedSpotlightLaunchRegistered).not.toHaveBeenCalled()
  })

  it('tears the capture down and watches the terminal when Spotlight turned off during the registration', async () => {
    mocks.startSpotlightLogCapture.mockImplementationOnce(async () => {
      mocks.getState.mockReturnValue(null)
    })

    await invoke('spotlight:setLogPty', { repoId: LOCAL_REPO.id, ptyId: 'pty-1' })

    expect(mocks.stopSpotlightLogCapture).toHaveBeenCalledWith({
      repoId: LOCAL_REPO.id,
      ptyId: 'pty-1'
    })
    expect(mocks.watchLateSpotlightTerminal).toHaveBeenCalledWith(LOCAL_REPO.id, 'pty-1')
    expect(mocks.markPreparedSpotlightLaunchRegistered).not.toHaveBeenCalled()
  })
})

describe('spotlight:restartServer', () => {
  it('is not registered: nothing in the renderer restarts the server directly', () => {
    expect(mocks.handlers.has('spotlight:restartServer')).toBe(false)
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
