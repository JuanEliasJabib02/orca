import './mock-descendant-sweep'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ProcessTableRow } from '../../shared/process-table-snapshot'
import type * as SnapshotReader from '../../shared/process-table-snapshot-reader'
import type { SubprocessHandle } from './session-subprocess-handle'
import { TerminalHost } from './terminal-host'

const { readSnapshot } = vi.hoisted(() => ({ readSnapshot: vi.fn() }))
vi.mock('../../shared/process-table-snapshot-reader', async (importOriginal) => ({
  ...(await importOriginal<typeof SnapshotReader>()),
  getStrictProcessTableSnapshotWithAge: readSnapshot
}))

// The PTY's spawned pid is macOS `login`; the login shell runs under it in its own group.
const LOGIN = 99_999
const ZSH = 100_000
const SCRIPT = 100_001

function createSubprocess(): SubprocessHandle {
  let onExit: ((code: number) => void) | null = null
  return {
    pid: LOGIN,
    // What node-pty names for the `pnpm` shim: a shell's name.
    getForegroundProcess: vi.fn(() => 'sh'),
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(() => onExit?.(0)),
    terminateOwnedTree: () => 'unavailable',
    forceKill: vi.fn(() => onExit?.(137)),
    signal: vi.fn(),
    onData: vi.fn(),
    onExit: (callback) => {
      onExit = callback
    },
    dispose: vi.fn()
  }
}

function row(pid: number, ppid: number, pgid: number, tpgid: number, command: string) {
  const stat = pgid === tpgid ? 'S+' : 'S'
  return { pid, ppid, pgid, tpgid, tty: 'ttys004', startTime: `start-${pid}`, stat, command }
}

function terminalRows(scriptRunning: boolean): ProcessTableRow[] {
  const foreground = scriptRunning ? SCRIPT : ZSH
  const rows = [
    row(LOGIN, 1, LOGIN, foreground, '/usr/bin/login -flpq juan /bin/zsh -l'),
    row(ZSH, LOGIN, ZSH, foreground, '-/bin/zsh -l')
  ]
  return scriptRunning
    ? [...rows, row(SCRIPT, ZSH, SCRIPT, SCRIPT, '/bin/sh /Users/juan/Library/pnpm/pnpm local')]
    : rows
}

async function inspectWith(
  rows: ProcessTableRow[] | Error,
  options?: { steadyState?: boolean }
): Promise<unknown> {
  readSnapshot.mockImplementation(async () => {
    if (rows instanceof Error) {
      throw rows
    }
    return { rows, capturedAgeMs: 0 }
  })
  const host = new TerminalHost({ spawnSubprocess: () => createSubprocess() })
  try {
    await host.createOrAttach({
      sessionId: 'spotlight-session',
      cols: 80,
      rows: 24,
      streamClient: { onData: vi.fn(), onExit: vi.fn() }
    })
    return await host.inspectProcess('spotlight-session', options)
  } finally {
    await host.dispose()
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  readSnapshot.mockReset()
})

describe.each(['darwin', 'linux'] as const)('daemon foreground group on %s', (platform) => {
  it('reports a sh script in front as a job, though node-pty names a shell', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue(platform)

    expect(await inspectWith(terminalRows(true))).toMatchObject({
      hasChildProcesses: false,
      foregroundGroup: 'job'
    })
  })

  it('reports the login shell at its prompt as the shell', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue(platform)

    expect(await inspectWith(terminalRows(false))).toMatchObject({ foregroundGroup: 'shell' })
  })

  it('leaves the group out when the process table cannot be read', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue(platform)

    expect(await inspectWith(new Error('ps failed'))).not.toHaveProperty('foregroundGroup')
  })
})

describe('daemon foreground group on Windows', () => {
  it('is never reported', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')

    expect(await inspectWith(terminalRows(true))).not.toHaveProperty('foregroundGroup')
  })
})
