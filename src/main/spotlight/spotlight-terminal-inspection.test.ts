import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fakePty = vi.hoisted(() => ({
  hasChildProcesses: vi.fn(async (_id: string): Promise<boolean> => false),
  getForegroundProcess: vi.fn(async (_id: string): Promise<string | null> => 'zsh'),
  confirmShellForeground: undefined as ((id: string) => Promise<boolean>) | undefined
}))

vi.mock('../ipc/pty', () => ({ getLocalPtyProvider: () => fakePty }))

import { readSpotlightTerminal } from './spotlight-terminal-inspection'

const PTY_ID = 'pty-1'
const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')

function onPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { configurable: true, value: platform })
}

beforeEach(() => {
  fakePty.hasChildProcesses.mockReset()
  fakePty.hasChildProcesses.mockResolvedValue(false)
  fakePty.getForegroundProcess.mockReset()
  fakePty.getForegroundProcess.mockResolvedValue('zsh')
  fakePty.confirmShellForeground = undefined
})

afterEach(() => {
  vi.useRealTimers()
  if (originalPlatform) {
    Object.defineProperty(process, 'platform', originalPlatform)
  }
})

describe('readSpotlightTerminal', () => {
  it('reads a shell in the foreground as idle off Windows, without an ownership proof', async () => {
    onPlatform('darwin')
    const confirm = vi.fn(async () => false)
    fakePty.confirmShellForeground = confirm

    expect(await readSpotlightTerminal(PTY_ID)).toEqual({ kind: 'idle', shell: 'zsh' })
    // The daemon answers this from its TUI-ownership model, false for a plain prompt.
    expect(confirm).not.toHaveBeenCalled()
  })

  it('reads children or a non-shell foreground as busy', async () => {
    fakePty.hasChildProcesses.mockResolvedValueOnce(true)
    expect(await readSpotlightTerminal(PTY_ID)).toEqual({ kind: 'busy' })

    fakePty.getForegroundProcess.mockResolvedValueOnce('node')
    expect(await readSpotlightTerminal(PTY_ID)).toEqual({ kind: 'busy' })
  })

  it('reads an unanswered or failed check as unknown', async () => {
    fakePty.getForegroundProcess.mockResolvedValueOnce(null)
    expect(await readSpotlightTerminal(PTY_ID)).toEqual({ kind: 'unknown' })

    fakePty.hasChildProcesses.mockRejectedValueOnce(new Error('host gone'))
    expect(await readSpotlightTerminal(PTY_ID)).toEqual({ kind: 'unknown' })
  })

  it('reads unknown when the check hangs', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    fakePty.hasChildProcesses.mockReturnValue(new Promise<boolean>(() => {}))

    const reading = readSpotlightTerminal(PTY_ID)
    await vi.advanceTimersByTimeAsync(3000)

    expect(await reading).toEqual({ kind: 'unknown' })
  })

  describe('on Windows, where the foreground name is the spawned shell whatever runs', () => {
    beforeEach(() => {
      onPlatform('win32')
      fakePty.getForegroundProcess.mockResolvedValue('powershell.exe')
    })

    it('is idle when the host confirms the shell owns the foreground', async () => {
      fakePty.confirmShellForeground = vi.fn(async () => true)

      expect(await readSpotlightTerminal(PTY_ID)).toEqual({
        kind: 'idle',
        shell: 'powershell.exe'
      })
      expect(fakePty.confirmShellForeground).toHaveBeenCalledWith(PTY_ID)
    })

    it('is not idle when the host cannot confirm it', async () => {
      fakePty.confirmShellForeground = vi.fn(async () => false)

      expect(await readSpotlightTerminal(PTY_ID)).toEqual({ kind: 'unknown' })
    })

    it('is unverifiable without an ownership proof to ask for', async () => {
      expect(await readSpotlightTerminal(PTY_ID)).toEqual({ kind: 'unknown' })
    })
  })
})
