import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SpotlightOpResult } from '../../../../shared/spotlight'
import { createTestStore } from './store-test-helpers'

const mockApi = {
  spotlight: { activate: vi.fn(), deactivate: vi.fn() }
}
// @ts-expect-error test window mock
globalThis.window = { api: mockApi }

const openSpotlightTerminalAndStartServer = vi.fn()
const toast = vi.hoisted(() => ({
  error: vi.fn<(title: string, options?: { action?: { onClick: () => void } }) => void>(),
  success: vi.fn(),
  warning: vi.fn()
}))

vi.mock('sonner', () => ({ toast }))

vi.mock('@/lib/spotlight-server-autostart', () => ({
  openSpotlightTerminalAndStartServer: (...args: unknown[]) =>
    openSpotlightTerminalAndStartServer(...args)
}))

const OK: SpotlightOpResult = { ok: true, state: null }
const FAILED: SpotlightOpResult = {
  ok: false,
  error: { code: 'git-failed', message: 'git failed' },
  state: null
}

beforeEach(() => {
  vi.clearAllMocks()
  openSpotlightTerminalAndStartServer.mockResolvedValue({
    opened: { ok: true, tabId: 'tab-1' },
    server: { kind: 'none' }
  })
})

describe('activateSpotlight quiet option', () => {
  it('toasts success by default', async () => {
    mockApi.spotlight.activate.mockResolvedValue(OK)

    await createTestStore().getState().activateSpotlight('repo-1', 'wt-1')

    expect(toast.success).toHaveBeenCalledTimes(1)
  })

  it('drops the success toast but still opens the server terminal', async () => {
    mockApi.spotlight.activate.mockResolvedValue(OK)

    const result = await createTestStore()
      .getState()
      .activateSpotlight('repo-1', 'wt-1', { quiet: true })

    expect(result).toEqual(OK)
    expect(toast.success).not.toHaveBeenCalled()
    expect(openSpotlightTerminalAndStartServer).toHaveBeenCalledWith({
      repoId: 'repo-1',
      worktreeId: 'wt-1'
    })
  })

  it('still toasts a failure', async () => {
    mockApi.spotlight.activate.mockResolvedValue(FAILED)

    await createTestStore().getState().activateSpotlight('repo-1', 'wt-1', { quiet: true })

    expect(toast.error).toHaveBeenCalledTimes(1)
  })

  it('offers "Activate anyway" without carrying quiet into the forced retry', async () => {
    mockApi.spotlight.activate.mockResolvedValueOnce({
      ok: false,
      error: { code: 'root-diverged', message: 'diverged' },
      state: null
    })
    mockApi.spotlight.activate.mockResolvedValue(OK)

    await createTestStore().getState().activateSpotlight('repo-1', 'wt-1', { quiet: true })
    toast.error.mock.calls[0]?.[1]?.action?.onClick()
    await vi.waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1))

    expect(mockApi.spotlight.activate).toHaveBeenLastCalledWith({
      repoId: 'repo-1',
      worktreeId: 'wt-1',
      force: true
    })
  })
})

describe('activateSpotlight server autostart', () => {
  it('names the started command in the success toast', async () => {
    mockApi.spotlight.activate.mockResolvedValue(OK)
    openSpotlightTerminalAndStartServer.mockResolvedValue({
      opened: { ok: true, tabId: 'tab-1' },
      server: { kind: 'queued', command: 'pnpm local --port 3000' }
    })

    await createTestStore().getState().activateSpotlight('repo-1', 'wt-1')

    expect(toast.success).toHaveBeenCalledWith(
      'Spotlight on — the project root now mirrors this workspace',
      { description: 'Starting pnpm local --port 3000 — logs at .orca/spotlight.log' }
    )
  })

  it('says so when a takeover restarted the server with another command', async () => {
    mockApi.spotlight.activate.mockResolvedValue(OK)
    openSpotlightTerminalAndStartServer.mockResolvedValue({
      opened: { ok: true, tabId: 'tab-1' },
      server: { kind: 'restarted', command: 'pnpm dev --port 3000' }
    })

    await createTestStore().getState().activateSpotlight('repo-1', 'wt-1')

    expect(toast.success).toHaveBeenCalledWith(expect.any(String), {
      description: 'Restarting with pnpm dev --port 3000 — logs at .orca/spotlight.log'
    })
  })

  it('keeps the log hint when nothing was started', async () => {
    mockApi.spotlight.activate.mockResolvedValue(OK)

    await createTestStore().getState().activateSpotlight('repo-1', 'wt-1')

    expect(toast.success).toHaveBeenCalledWith(expect.any(String), {
      description: 'Server logs are mirrored for agents at .orca/spotlight.log'
    })
  })

  it('starts the server in a quiet (whole-task) batch without a toast', async () => {
    mockApi.spotlight.activate.mockResolvedValue(OK)
    openSpotlightTerminalAndStartServer.mockResolvedValue({
      opened: { ok: true, tabId: 'tab-1' },
      server: { kind: 'started', command: 'pnpm local' }
    })

    await createTestStore().getState().activateSpotlight('repo-1', 'wt-1', { quiet: true })

    expect(openSpotlightTerminalAndStartServer).toHaveBeenCalledTimes(1)
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('starts nothing when the activation fails', async () => {
    mockApi.spotlight.activate.mockResolvedValue(FAILED)

    await createTestStore().getState().activateSpotlight('repo-1', 'wt-1')

    expect(openSpotlightTerminalAndStartServer).not.toHaveBeenCalled()
  })
})

describe('deactivateSpotlight quiet option', () => {
  it('toasts success by default', async () => {
    mockApi.spotlight.deactivate.mockResolvedValue(OK)

    await createTestStore().getState().deactivateSpotlight('repo-1')

    expect(toast.success).toHaveBeenCalledTimes(1)
  })

  it('drops the success toast', async () => {
    mockApi.spotlight.deactivate.mockResolvedValue(OK)

    const result = await createTestStore().getState().deactivateSpotlight('repo-1', { quiet: true })

    expect(result).toEqual(OK)
    expect(toast.success).not.toHaveBeenCalled()
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('still toasts a failure', async () => {
    mockApi.spotlight.deactivate.mockResolvedValue(FAILED)

    await createTestStore().getState().deactivateSpotlight('repo-1', { quiet: true })

    expect(toast.error).toHaveBeenCalledTimes(1)
  })

  it('keeps the detached-root warning', async () => {
    mockApi.spotlight.deactivate.mockResolvedValue({ ...OK, leftDetachedFromBranch: 'main' })

    await createTestStore().getState().deactivateSpotlight('repo-1', { quiet: true })

    expect(toast.warning).toHaveBeenCalledTimes(1)
    expect(toast.success).not.toHaveBeenCalled()
  })
})

describe('failure titles naming the project', () => {
  const DIVERGED: SpotlightOpResult = {
    ok: false,
    error: { code: 'root-diverged', message: 'diverged' },
    state: null
  }

  it('keeps the plain title for a single-repo call', async () => {
    mockApi.spotlight.activate.mockResolvedValue(FAILED)
    mockApi.spotlight.deactivate.mockResolvedValue(FAILED)

    await createTestStore().getState().activateSpotlight('repo-1', 'wt-1')
    await createTestStore().getState().deactivateSpotlight('repo-1')

    expect(toast.error.mock.calls.map(([title]) => title)).toEqual([
      'Failed to start Spotlight',
      'Failed to turn off Spotlight'
    ])
  })

  it('names the project on activate and again on the "Activate anyway" retry', async () => {
    mockApi.spotlight.activate.mockResolvedValueOnce(DIVERGED)
    mockApi.spotlight.activate.mockResolvedValue(FAILED)

    await createTestStore()
      .getState()
      .activateSpotlight('repo-1', 'wt-1', { quiet: true, projectName: 'backend' })

    expect(toast.error).toHaveBeenCalledWith(
      'Failed to start Spotlight in backend',
      expect.objectContaining({ action: expect.objectContaining({ label: 'Activate anyway' }) })
    )
    toast.error.mock.calls[0]?.[1]?.action?.onClick()
    await vi.waitFor(() => expect(toast.error).toHaveBeenCalledTimes(2))
    expect(toast.error.mock.calls[1]?.[0]).toBe('Failed to start Spotlight in backend')
  })

  it('names the project on deactivate and keeps "Turn off anyway"', async () => {
    mockApi.spotlight.deactivate.mockResolvedValue(DIVERGED)

    await createTestStore()
      .getState()
      .deactivateSpotlight('repo-1', { quiet: true, projectName: 'admin' })

    expect(toast.error).toHaveBeenCalledWith(
      'Failed to turn off Spotlight in admin',
      expect.objectContaining({ action: expect.objectContaining({ label: 'Turn off anyway' }) })
    )
  })
})
