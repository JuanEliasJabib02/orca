import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SpotlightOpResult } from '../../../../shared/spotlight'
import { createTestStore } from './store-test-helpers'

const mockApi = {
  spotlight: { activate: vi.fn(), deactivate: vi.fn() }
}
// @ts-expect-error test window mock
globalThis.window = { api: mockApi }

const openSpotlightTerminalTab = vi.fn()
const toast = vi.hoisted(() => ({
  error: vi.fn<(title: string, options?: { action?: { onClick: () => void } }) => void>(),
  success: vi.fn(),
  warning: vi.fn()
}))

vi.mock('sonner', () => ({ toast }))

vi.mock('@/lib/open-spotlight-terminal-tab', () => ({
  openSpotlightTerminalTab: (...args: unknown[]) => openSpotlightTerminalTab(...args)
}))

const OK: SpotlightOpResult = { ok: true, state: null }
const FAILED: SpotlightOpResult = {
  ok: false,
  error: { code: 'git-failed', message: 'git failed' },
  state: null
}

beforeEach(() => {
  vi.clearAllMocks()
  openSpotlightTerminalTab.mockReturnValue({ ok: true, tabId: 'tab-1' })
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
    expect(openSpotlightTerminalTab).toHaveBeenCalledWith({ repoId: 'repo-1', reveal: false })
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
