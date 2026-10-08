import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PtyProcessInspection } from '../providers/pty-process-inspection'

const fakePty = vi.hoisted(() => ({
  hasChildProcesses: vi.fn(async (_id: string): Promise<boolean> => false),
  getForegroundProcess: vi.fn(async (_id: string): Promise<string | null> => 'zsh'),
  inspectProcess: undefined as
    | ((id: string, options?: { observeForegroundGroup?: boolean }) => Promise<unknown>)
    | undefined,
  confirmShellForeground: undefined as ((id: string) => Promise<boolean>) | undefined,
  hasPty: undefined as ((id: string) => boolean) | undefined,
  probePtyLiveness: undefined as ((id: string) => Promise<boolean | null>) | undefined
}))

vi.mock('../ipc/pty', () => ({ getLocalPtyProvider: () => fakePty }))

import {
  isSpotlightTerminalGone,
  readSpotlightServerState,
  readSpotlightTerminal
} from './spotlight-terminal-inspection'

const PTY_ID = 'pty-1'
const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')

function onPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { configurable: true, value: platform })
}

/** What the PTY host answers on POSIX for this terminal. */
function hostAnswers(inspection: PtyProcessInspection): ReturnType<typeof vi.fn> {
  const inspect = vi.fn(async () => inspection)
  fakePty.inspectProcess = inspect
  return inspect
}

beforeEach(() => {
  onPlatform('darwin')
  fakePty.hasChildProcesses.mockReset()
  fakePty.hasChildProcesses.mockResolvedValue(false)
  fakePty.getForegroundProcess.mockReset()
  fakePty.getForegroundProcess.mockResolvedValue('zsh')
  fakePty.inspectProcess = undefined
  fakePty.confirmShellForeground = undefined
  fakePty.hasPty = undefined
  fakePty.probePtyLiveness = undefined
})

afterEach(() => {
  vi.useRealTimers()
  if (originalPlatform) {
    Object.defineProperty(process, 'platform', originalPlatform)
  }
})

describe('readSpotlightTerminal off Windows', () => {
  it('reads the prompt as idle when the shell owns the foreground group', async () => {
    const inspect = hostAnswers({
      foregroundProcess: '-zsh',
      hasChildProcesses: false,
      foregroundGroup: 'shell'
    })

    expect(await readSpotlightTerminal(PTY_ID)).toEqual({ kind: 'idle', shell: 'zsh' })
    expect(inspect).toHaveBeenCalledWith(PTY_ID, { observeForegroundGroup: true })
  })

  it('stays idle when the host names no foreground (a daemon at its prompt)', async () => {
    hostAnswers({ foregroundProcess: null, hasChildProcesses: false, foregroundGroup: 'shell' })

    expect(await readSpotlightTerminal(PTY_ID)).toEqual({ kind: 'idle', shell: null })
  })

  it.each(['sh', 'bash', '-bash'])(
    'reads a %s script in the foreground group as busy, though its name is a shell',
    async (name) => {
      hostAnswers({ foregroundProcess: name, hasChildProcesses: false, foregroundGroup: 'job' })

      expect(await readSpotlightTerminal(PTY_ID)).toEqual({ kind: 'busy' })
    }
  )

  it('never trusts a shell name alone from a host that predates the group reading', async () => {
    hostAnswers({ foregroundProcess: 'sh', hasChildProcesses: false })
    expect(await readSpotlightTerminal(PTY_ID)).toEqual({ kind: 'unknown' })

    hostAnswers({ foregroundProcess: null, hasChildProcesses: false })
    expect(await readSpotlightTerminal(PTY_ID)).toEqual({ kind: 'unknown' })
  })

  it('still reads busy from an older host that names a command or sees children', async () => {
    hostAnswers({ foregroundProcess: 'node', hasChildProcesses: true })
    expect(await readSpotlightTerminal(PTY_ID)).toEqual({ kind: 'busy' })

    hostAnswers({
      foregroundProcess: 'zsh',
      hasChildProcesses: true,
      childProcessEvidence: 'children'
    })
    expect(await readSpotlightTerminal(PTY_ID)).toEqual({ kind: 'busy' })
  })

  it('reads unverifiable child evidence as unknown, not busy', async () => {
    hostAnswers({
      foregroundProcess: 'zsh',
      hasChildProcesses: true,
      childProcessEvidence: 'unverifiable'
    })

    expect(await readSpotlightTerminal(PTY_ID)).toEqual({ kind: 'unknown' })
  })

  it('composes the old reads for a provider without the inspect operation', async () => {
    expect(await readSpotlightTerminal(PTY_ID)).toEqual({ kind: 'unknown' })

    fakePty.getForegroundProcess.mockResolvedValueOnce('node')
    expect(await readSpotlightTerminal(PTY_ID)).toEqual({ kind: 'busy' })
  })

  it('reads a failed or client-only check as unknown', async () => {
    fakePty.inspectProcess = vi.fn(async () => {
      throw new Error('host gone')
    })
    expect(await readSpotlightTerminal(PTY_ID)).toEqual({ kind: 'unknown' })

    hostAnswers({
      foregroundProcess: null,
      hasChildProcesses: false,
      verdict: 'unverifiable',
      reason: 'transport_loss'
    })
    expect(await readSpotlightTerminal(PTY_ID)).toEqual({ kind: 'unknown' })
  })

  it('reads unknown when the PTY is not in the provider', async () => {
    hostAnswers({ foregroundProcess: null, hasChildProcesses: false, foregroundGroup: 'shell' })
    fakePty.hasPty = () => false

    expect(await readSpotlightTerminal(PTY_ID)).toEqual({ kind: 'unknown' })
  })

  it('reads unknown when the check hangs', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    fakePty.inspectProcess = () => new Promise(() => {})

    const reading = readSpotlightTerminal(PTY_ID)
    await vi.advanceTimersByTimeAsync(3000)

    expect(await reading).toEqual({ kind: 'unknown' })
  })
})

describe('readSpotlightTerminal on Windows, where the foreground name is the spawned shell', () => {
  beforeEach(() => {
    onPlatform('win32')
    fakePty.getForegroundProcess.mockResolvedValue('powershell.exe')
  })

  it('is idle when the host confirms the shell owns the foreground', async () => {
    fakePty.confirmShellForeground = vi.fn(async () => true)

    expect(await readSpotlightTerminal(PTY_ID)).toEqual({ kind: 'idle', shell: 'powershell.exe' })
    expect(fakePty.confirmShellForeground).toHaveBeenCalledWith(PTY_ID)
  })

  it('is not idle when the host cannot confirm it', async () => {
    fakePty.confirmShellForeground = vi.fn(async () => false)

    expect(await readSpotlightTerminal(PTY_ID)).toEqual({ kind: 'unknown' })
  })

  it('is unverifiable without an ownership proof to ask for', async () => {
    expect(await readSpotlightTerminal(PTY_ID)).toEqual({ kind: 'unknown' })
  })

  it('reads children or a non-shell foreground as busy, and never asks for process groups', async () => {
    const inspect = hostAnswers({
      foregroundProcess: null,
      hasChildProcesses: false,
      foregroundGroup: 'shell'
    })
    fakePty.hasChildProcesses.mockResolvedValueOnce(true)
    expect(await readSpotlightTerminal(PTY_ID)).toEqual({ kind: 'busy' })

    fakePty.getForegroundProcess.mockResolvedValueOnce('node.exe')
    expect(await readSpotlightTerminal(PTY_ID)).toEqual({ kind: 'busy' })
    expect(inspect).not.toHaveBeenCalled()
  })
})

describe('readSpotlightServerState', () => {
  it('maps the reading the flashlight shows', async () => {
    hostAnswers({ foregroundProcess: 'sh', hasChildProcesses: false, foregroundGroup: 'job' })
    expect(await readSpotlightServerState(PTY_ID)).toBe('running')

    hostAnswers({ foregroundProcess: 'zsh', hasChildProcesses: false, foregroundGroup: 'shell' })
    expect(await readSpotlightServerState(PTY_ID)).toBe('stopped')

    hostAnswers({ foregroundProcess: 'zsh', hasChildProcesses: false })
    expect(await readSpotlightServerState(PTY_ID)).toBe('unknown')
  })
})

describe('isSpotlightTerminalGone', () => {
  it('is gone only when the host answers the PTY does not exist', async () => {
    fakePty.hasPty = () => false
    fakePty.probePtyLiveness = vi.fn(async () => false)
    expect(await isSpotlightTerminalGone(PTY_ID)).toBe(true)

    fakePty.probePtyLiveness = vi.fn(async () => null)
    expect(await isSpotlightTerminalGone(PTY_ID)).toBe(false)

    fakePty.probePtyLiveness = vi.fn(async () => true)
    expect(await isSpotlightTerminalGone(PTY_ID)).toBe(false)
  })

  it('never probes a PTY the provider already holds', async () => {
    fakePty.hasPty = () => true
    const probe = vi.fn(async () => false)
    fakePty.probePtyLiveness = probe

    expect(await isSpotlightTerminalGone(PTY_ID)).toBe(false)
    expect(probe).not.toHaveBeenCalled()
  })

  it('trusts the in-process inventory of a provider with no liveness probe', async () => {
    fakePty.hasPty = () => false
    expect(await isSpotlightTerminalGone(PTY_ID)).toBe(true)

    fakePty.hasPty = undefined
    expect(await isSpotlightTerminalGone(PTY_ID)).toBe(false)
  })

  it('reads a failed or hung probe as not gone', async () => {
    fakePty.hasPty = () => false
    fakePty.probePtyLiveness = vi.fn(async () => {
      throw new Error('daemon gone')
    })
    expect(await isSpotlightTerminalGone(PTY_ID)).toBe(false)

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    fakePty.probePtyLiveness = () => new Promise(() => {})
    const gone = isSpotlightTerminalGone(PTY_ID)
    await vi.advanceTimersByTimeAsync(3000)
    expect(await gone).toBe(false)
  })
})
