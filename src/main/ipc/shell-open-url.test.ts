import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as ArcSpaceUrlOpen from '../arc-space-url-open'

const { handleMock, openExternalMock, openUrlInArcSpaceMock } = vi.hoisted(() => ({
  handleMock: vi.fn(),
  openExternalMock: vi.fn(),
  openUrlInArcSpaceMock: vi.fn()
}))

vi.mock('electron', () => ({
  ipcMain: { handle: handleMock },
  shell: { openExternal: openExternalMock, showItemInFolder: vi.fn(), openPath: vi.fn() },
  dialog: { showOpenDialog: vi.fn() }
}))

vi.mock('../arc-space-url-open', async (importOriginal) => ({
  ...(await importOriginal<typeof ArcSpaceUrlOpen>()),
  openUrlInArcSpace: openUrlInArcSpaceMock
}))

import { registerShellHandlers } from './shell'

describe('shell:openUrl', () => {
  const settings = { activeRuntimeEnvironmentId: null, openLinksInArcSpaces: false }
  const store = { getSettings: () => settings, getSshTarget: () => undefined }

  beforeEach(() => {
    handleMock.mockReset()
    openExternalMock.mockReset()
    openUrlInArcSpaceMock.mockReset()
    openExternalMock.mockResolvedValue(undefined)
    settings.openLinksInArcSpaces = false
  })

  function openUrl(...args: unknown[]): Promise<unknown> {
    registerShellHandlers(store as never)
    const call = handleMock.mock.calls.find((c: unknown[]) => c[0] === 'shell:openUrl')
    if (!call) {
      throw new Error('shell:openUrl handler not registered')
    }
    const handler: unknown = call[1]
    if (typeof handler !== 'function') {
      throw new Error('shell:openUrl handler is not a function')
    }
    return Promise.resolve(handler({}, ...args))
  }

  it('opens in the system browser without asking Arc when the opt-in is off', async () => {
    await openUrl('https://example.com/a', { arcSpace: 'Action' })
    expect(openUrlInArcSpaceMock).not.toHaveBeenCalled()
    expect(openExternalMock).toHaveBeenCalledWith('https://example.com/a')
  })

  it('opens in the requested Arc space when the opt-in is on', async () => {
    settings.openLinksInArcSpaces = true
    openUrlInArcSpaceMock.mockResolvedValue(true)
    await openUrl('https://example.com/a', { arcSpace: ' Bulbasour ' })
    expect(openUrlInArcSpaceMock).toHaveBeenCalledWith('https://example.com/a', 'Bulbasour')
    expect(openExternalMock).not.toHaveBeenCalled()
  })

  it('falls back to the system browser when Arc cannot open it', async () => {
    settings.openLinksInArcSpaces = true
    openUrlInArcSpaceMock.mockResolvedValue(false)
    await openUrl('https://example.com/a', { arcSpace: 'Missing' })
    expect(openExternalMock).toHaveBeenCalledWith('https://example.com/a')
  })

  it.each([undefined, null, 'Action', {}, { arcSpace: '' }, { arcSpace: '  ' }, { arcSpace: 7 }])(
    'ignores a missing or malformed Arc space: %j',
    async (options) => {
      settings.openLinksInArcSpaces = true
      await openUrl('https://example.com/a', options)
      expect(openUrlInArcSpaceMock).not.toHaveBeenCalled()
      expect(openExternalMock).toHaveBeenCalledWith('https://example.com/a')
    }
  )

  it('still refuses non-http URLs before reaching Arc', async () => {
    settings.openLinksInArcSpaces = true
    await openUrl('file:///etc/passwd', { arcSpace: 'Action' })
    expect(openUrlInArcSpaceMock).not.toHaveBeenCalled()
    expect(openExternalMock).not.toHaveBeenCalled()
  })
})
