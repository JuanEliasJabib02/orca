import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RemoteForegroundEvidence } from '../../shared/foreground-process-evidence'
import type { ProcessTableRow } from '../../shared/process-table-snapshot'
import type * as SnapshotReader from '../../shared/process-table-snapshot-reader'
import type { IPtyProvider, PtyProcessInfo } from './types'

const { readTable } = vi.hoisted(() => ({
  readTable: vi.fn<() => Promise<ProcessTableRow[]>>()
}))

vi.mock('../../shared/process-table-snapshot-reader', async (importOriginal) => ({
  ...(await importOriginal<typeof SnapshotReader>()),
  getStrictProcessTableSnapshot: readTable
}))

import { readPtyForegroundGroupFallback } from './pty-foreground-group-fallback'

const PTY_ID = 'pty-1'
const LOGIN = 500
const ZSH = 501
const SCRIPT = 600
const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')

function row(pid: number, ppid: number, pgid: number, tpgid: number, command: string) {
  return { pid, ppid, pgid, tpgid, tty: 'ttys004', stat: 'S', command }
}

/** macOS: the PTY spawns `login`, which runs zsh; `pnpm local` is a `sh` shim in its own group. */
function terminalRows(scriptRunning: boolean): ProcessTableRow[] {
  const foreground = scriptRunning ? SCRIPT : ZSH
  return [
    row(LOGIN, 1, LOGIN, foreground, '/usr/bin/login -flpq juan /bin/zsh -l'),
    row(ZSH, LOGIN, ZSH, foreground, '-/bin/zsh -l'),
    ...(scriptRunning
      ? [
          row(SCRIPT, ZSH, SCRIPT, SCRIPT, '/bin/sh /Users/juan/Library/pnpm/pnpm local'),
          row(SCRIPT + 1, SCRIPT, SCRIPT, SCRIPT, 'node /Users/juan/Library/pnpm/pnpm.cjs local')
        ]
      : [])
  ]
}

function liveEvidence(
  shellPid: number,
  overrides: Partial<{ ptyId: string }> = {}
): RemoteForegroundEvidence {
  return {
    verdict: 'live',
    processName: null,
    fence: {
      platform: 'posix',
      shellPid,
      shellStartTime: 'Thu Oct  1 09:00:00 2026',
      tty: 'ttys004',
      foregroundPgid: ZSH
    },
    authorityGeneration: 'generation-1',
    observationEpoch: 1,
    capturedAgeMs: 0,
    ptyId: PTY_ID,
    ptyIncarnationId: 'incarnation-1',
    ...overrides
  }
}

const UNVERIFIABLE: RemoteForegroundEvidence = {
  verdict: 'unverifiable',
  reason: 'tty_boundary',
  authorityGeneration: 'generation-1',
  observationEpoch: 1,
  capturedAgeMs: 0,
  ptyId: PTY_ID,
  ptyIncarnationId: 'incarnation-1'
}

function providerListing(...processes: PtyProcessInfo[]) {
  const listProcesses = vi.fn(async (): Promise<PtyProcessInfo[]> => processes)
  const provider: Pick<IPtyProvider, 'listProcesses'> = { listProcesses }
  return { provider, listProcesses }
}

function listed(id: string, rootProcessId?: number): PtyProcessInfo {
  return { id, cwd: '/repo', title: 'shell', ...(rootProcessId ? { rootProcessId } : {}) }
}

beforeEach(() => {
  Object.defineProperty(process, 'platform', { configurable: true, value: 'darwin' })
  readTable.mockReset()
})

afterEach(() => {
  if (originalPlatform) {
    Object.defineProperty(process, 'platform', originalPlatform)
  }
})

describe('readPtyForegroundGroupFallback', () => {
  it('reads the root pid from a live POSIX fence, without asking the inventory', async () => {
    const { provider, listProcesses } = providerListing()
    readTable.mockResolvedValue(terminalRows(true))
    expect(await readPtyForegroundGroupFallback(provider, PTY_ID, liveEvidence(LOGIN))).toBe('job')

    readTable.mockResolvedValue(terminalRows(false))
    expect(await readPtyForegroundGroupFallback(provider, PTY_ID, liveEvidence(LOGIN))).toBe(
      'shell'
    )
    expect(listProcesses).not.toHaveBeenCalled()
  })

  it('asks the inventory when the answer has no usable fence', async () => {
    const { provider, listProcesses } = providerListing(
      listed('other-pty', 4242),
      listed(PTY_ID, LOGIN)
    )
    readTable.mockResolvedValue(terminalRows(true))

    expect(await readPtyForegroundGroupFallback(provider, PTY_ID, undefined)).toBe('job')
    expect(await readPtyForegroundGroupFallback(provider, PTY_ID, UNVERIFIABLE)).toBe('job')
    // A fence for another PTY says nothing about this one.
    expect(
      await readPtyForegroundGroupFallback(
        provider,
        PTY_ID,
        liveEvidence(4242, { ptyId: 'other-pty' })
      )
    ).toBe('job')
    expect(listProcesses).toHaveBeenCalledTimes(3)
  })

  it('is null without a root pid, and never reads the process table then', async () => {
    const { provider } = providerListing(listed(PTY_ID), listed('other-pty', LOGIN))

    expect(await readPtyForegroundGroupFallback(provider, PTY_ID, undefined)).toBeNull()
    expect(readTable).not.toHaveBeenCalled()
  })

  it('is null when the inventory or the capture fails', async () => {
    const failing: Pick<IPtyProvider, 'listProcesses'> = {
      listProcesses: vi.fn(async () => {
        throw new Error('daemon gone')
      })
    }
    expect(await readPtyForegroundGroupFallback(failing, PTY_ID, undefined)).toBeNull()

    readTable.mockRejectedValue(new Error('ps timed out'))
    const { provider } = providerListing(listed(PTY_ID, LOGIN))
    expect(await readPtyForegroundGroupFallback(provider, PTY_ID, undefined)).toBeNull()
  })

  it('is null when the capture cannot tell (the root is gone)', async () => {
    readTable.mockResolvedValue(terminalRows(false).filter((entry) => entry.pid !== LOGIN))

    const { provider } = providerListing()
    expect(await readPtyForegroundGroupFallback(provider, PTY_ID, liveEvidence(LOGIN))).toBeNull()
  })

  it('never runs on Windows, where process groups prove nothing', async () => {
    Object.defineProperty(process, 'platform', { configurable: true, value: 'win32' })
    const { provider, listProcesses } = providerListing(listed(PTY_ID, LOGIN))

    expect(await readPtyForegroundGroupFallback(provider, PTY_ID, liveEvidence(LOGIN))).toBeNull()
    expect(listProcesses).not.toHaveBeenCalled()
    expect(readTable).not.toHaveBeenCalled()
  })
})
