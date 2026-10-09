import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProcessTableRow } from '../../shared/process-table-snapshot'
import type * as SnapshotReader from '../../shared/process-table-snapshot-reader'
import type { PtyProcessInspection } from '../providers/pty-process-inspection'
import type { PtyProcessInfo } from '../providers/types'

const fakePty = vi.hoisted(() => ({
  hasChildProcesses: vi.fn(async (_id: string): Promise<boolean> => false),
  getForegroundProcess: vi.fn(async (_id: string): Promise<string | null> => 'zsh'),
  inspectProcess: undefined as
    | ((id: string, options?: { observeForegroundGroup?: boolean }) => Promise<unknown>)
    | undefined,
  confirmShellForeground: undefined as ((id: string) => Promise<boolean>) | undefined,
  hasPty: undefined as ((id: string) => boolean) | undefined,
  probePtyLiveness: undefined as ((id: string) => Promise<boolean | null>) | undefined,
  listProcesses: undefined as (() => Promise<PtyProcessInfo[]>) | undefined
}))
const { readTable } = vi.hoisted(() => ({
  readTable: vi.fn<() => Promise<ProcessTableRow[]>>()
}))

vi.mock('../ipc/pty', () => ({ getLocalPtyProvider: () => fakePty }))
vi.mock('../../shared/process-table-snapshot-reader', async (importOriginal) => ({
  ...(await importOriginal<typeof SnapshotReader>()),
  getStrictProcessTableSnapshot: readTable
}))

import {
  isSpotlightTerminalGone,
  readSpotlightServerState,
  readSpotlightTerminal
} from './spotlight-terminal-inspection'
import {
  OLD_DAEMON_ANSWER,
  SPOTLIGHT_TERMINAL_ROOT_PID,
  spotlightTerminalRows
} from './spotlight-terminal-test-pty'

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
  fakePty.listProcesses = undefined
  readTable.mockReset()
  readTable.mockRejectedValue(new Error('no process table in this test'))
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

describe('readSpotlightTerminal with a host that sends no foregroundGroup (an older daemon)', () => {
  const listed: PtyProcessInfo = {
    id: PTY_ID,
    rootProcessId: SPOTLIGHT_TERMINAL_ROOT_PID,
    cwd: '/repo',
    title: 'shell'
  }

  beforeEach(() => {
    hostAnswers(OLD_DAEMON_ANSWER)
    fakePty.listProcesses = vi.fn(async () => [listed])
  })

  it('reads a sh script running the server as busy, from the process table main reads', async () => {
    readTable.mockResolvedValue(spotlightTerminalRows(true))

    expect(await readSpotlightTerminal(PTY_ID)).toEqual({ kind: 'busy' })
  })

  it('reads the prompt as idle', async () => {
    readTable.mockResolvedValue(spotlightTerminalRows(false))

    expect(await readSpotlightTerminal(PTY_ID)).toEqual({ kind: 'idle', shell: null })
  })

  it('takes the pid from the answer when its fence is live, without asking the inventory', async () => {
    hostAnswers({
      ...OLD_DAEMON_ANSWER,
      foregroundProcessEvidence: {
        verdict: 'live',
        processName: null,
        fence: {
          platform: 'posix',
          shellPid: SPOTLIGHT_TERMINAL_ROOT_PID,
          shellStartTime: 'Thu Oct  1 09:00:00 2026',
          tty: 'ttys004',
          foregroundPgid: 600
        },
        authorityGeneration: 'generation-1',
        observationEpoch: 1,
        capturedAgeMs: 0,
        ptyId: PTY_ID,
        ptyIncarnationId: 'incarnation-1'
      }
    })
    readTable.mockResolvedValue(spotlightTerminalRows(true))

    expect(await readSpotlightTerminal(PTY_ID)).toEqual({ kind: 'busy' })
    expect(fakePty.listProcesses).not.toHaveBeenCalled()
  })

  it('stays unknown without a pid for the PTY, and never reads the process table', async () => {
    fakePty.listProcesses = vi.fn(async () => [{ ...listed, rootProcessId: undefined }])

    expect(await readSpotlightTerminal(PTY_ID)).toEqual({ kind: 'unknown' })
    expect(readTable).not.toHaveBeenCalled()
  })

  it('stays unknown when the process table cannot be read', async () => {
    expect(await readSpotlightTerminal(PTY_ID)).toEqual({ kind: 'unknown' })
  })

  it('reads a named command as busy without a capture', async () => {
    hostAnswers({ foregroundProcess: 'node', hasChildProcesses: true })

    expect(await readSpotlightTerminal(PTY_ID)).toEqual({ kind: 'busy' })
    expect(readTable).not.toHaveBeenCalled()
  })

  it('trusts the host whenever it sends the group', async () => {
    hostAnswers({ foregroundProcess: 'zsh', hasChildProcesses: false, foregroundGroup: 'shell' })
    readTable.mockResolvedValue(spotlightTerminalRows(true))

    expect(await readSpotlightTerminal(PTY_ID)).toEqual({ kind: 'idle', shell: 'zsh' })
    expect(fakePty.listProcesses).not.toHaveBeenCalled()
  })

  it('gives the flashlight the same answer', async () => {
    readTable.mockResolvedValue(spotlightTerminalRows(true))
    expect(await readSpotlightServerState(PTY_ID)).toBe('running')

    readTable.mockResolvedValue(spotlightTerminalRows(false))
    expect(await readSpotlightServerState(PTY_ID)).toBe('stopped')

    fakePty.listProcesses = vi.fn(async () => [])
    expect(await readSpotlightServerState(PTY_ID)).toBe('unknown')
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

  it('never works out a group in main, even for a host that sends none (unconfirmed stays unknown)', async () => {
    fakePty.listProcesses = vi.fn(async () => [
      { id: PTY_ID, rootProcessId: SPOTLIGHT_TERMINAL_ROOT_PID, cwd: '/repo', title: 'shell' }
    ])
    hostAnswers(OLD_DAEMON_ANSWER)

    expect(await readSpotlightTerminal(PTY_ID)).toEqual({ kind: 'unknown' })
    expect(fakePty.listProcesses).not.toHaveBeenCalled()
    expect(readTable).not.toHaveBeenCalled()
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
