// Field cases: a `sh`/`bash` script running the server reads busy everywhere (a daemon that predates
// the group reading included), and a Spotlight terminal whose PTY no longer exists answers
// `terminal-gone` instead of being typed into.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import nodePath from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProcessTableRow } from '../../shared/process-table-snapshot'
import type * as SnapshotReader from '../../shared/process-table-snapshot-reader'
import type { PtyProcessInspection } from '../providers/pty-process-inspection'
import type { PtyProcessInfo } from '../providers/types'

const fakePty = vi.hoisted(() => {
  const writes: { id: string; data: string }[] = []
  return {
    writes,
    write: vi.fn((id: string, data: string): boolean => {
      writes.push({ id, data })
      return true
    }),
    hasChildProcesses: vi.fn(async (_id: string): Promise<boolean> => false),
    getForegroundProcess: vi.fn(async (_id: string): Promise<string | null> => 'zsh'),
    inspectProcess: vi.fn<(id: string, options?: unknown) => Promise<PtyProcessInspection>>(),
    hasPty: vi.fn((_id: string): boolean => true),
    probePtyLiveness: vi.fn(async (_id: string): Promise<boolean | null> => true),
    listProcesses: vi.fn(async (): Promise<PtyProcessInfo[]> => []),
    onData: vi.fn(() => () => {})
  }
})
const { readTable } = vi.hoisted(() => ({
  readTable: vi.fn<() => Promise<ProcessTableRow[]>>()
}))

vi.mock('../ipc/pty', () => ({
  getLocalPtyProvider: () => fakePty,
  onLocalPtyProviderChanged: () => () => {}
}))
vi.mock('../../shared/process-table-snapshot-reader', async (importOriginal) => ({
  ...(await importOriginal<typeof SnapshotReader>()),
  getStrictProcessTableSnapshot: readTable
}))
vi.mock('../pwsh', () => ({ isPwshAvailableAsync: vi.fn(async () => false) }))
vi.mock('../git/runner', () => ({
  gitExecFileAsync: vi.fn(async () => ({ stdout: '.git/info/exclude', stderr: '' }))
}))

import { SPOTLIGHT_STRAY_STARTUP_WATCH_MS } from '../../shared/spotlight-stray-startup'
import {
  getSpotlightTerminal,
  startSpotlightLogCapture,
  stopSpotlightLogCapture
} from './spotlight-log-mirror'
import { forgetSpotlightServerCommand } from './spotlight-server-commands'
import {
  prepareSpotlightServerLaunch,
  startSpotlightServer,
  trackRegisteredSpotlightLaunch
} from './spotlight-server-control'
import { stopSpotlightServer } from './spotlight-server-turn-off'
import {
  OLD_DAEMON_ANSWER,
  SHELL_SCRIPT_RUNNING,
  SPOTLIGHT_TERMINAL_ROOT_PID,
  spotlightTerminalRows
} from './spotlight-terminal-test-pty'

const REPO_ID = 'repo-1'
const PTY_ID = 'pty-1'
const INTERRUPT = String.fromCharCode(3)
const BUSY = { ok: true, started: false, reason: 'busy' }
const AT_PROMPT: PtyProcessInspection = {
  foregroundProcess: 'zsh',
  hasChildProcesses: false,
  foregroundGroup: 'shell'
}
// What a daemon reports for a PTY it no longer knows: nothing to read there.
const UNREADABLE: PtyProcessInspection = { foregroundProcess: null, hasChildProcesses: false }
// Busy readings this far apart show a queued line running, not a shell's rc child.
const QUEUED_LINE_RAN_MS = 2500

let root = ''

function writtenData(): string[] {
  return fakePty.writes.map((entry) => entry.data)
}

beforeEach(async () => {
  fakePty.writes.length = 0
  fakePty.write.mockClear()
  fakePty.inspectProcess.mockReset()
  fakePty.inspectProcess.mockResolvedValue(AT_PROMPT)
  fakePty.hasPty.mockReset()
  fakePty.hasPty.mockReturnValue(true)
  fakePty.probePtyLiveness.mockReset()
  fakePty.probePtyLiveness.mockResolvedValue(true)
  fakePty.listProcesses.mockReset()
  fakePty.listProcesses.mockResolvedValue([])
  readTable.mockReset()
  readTable.mockRejectedValue(new Error('no process table in this test'))
  root = mkdtempSync(nodePath.join(tmpdir(), 'orca-spotlight-terminal-state-'))
  await startSpotlightLogCapture({ repoId: REPO_ID, ptyId: PTY_ID, rootPath: root })
})

afterEach(async () => {
  vi.useRealTimers()
  stopSpotlightLogCapture({ repoId: REPO_ID })
  forgetSpotlightServerCommand(REPO_ID)
  // Let fire-and-forget log notes land before the temp root goes away.
  await new Promise((resolve) => setTimeout(resolve, 50))
  rmSync(root, { recursive: true, force: true, maxRetries: 3 })
})

describe('a server run by a sh/bash script, whose foreground name is a shell', () => {
  it('is never typed into, and the command is kept for restarts', async () => {
    fakePty.inspectProcess.mockResolvedValue(SHELL_SCRIPT_RUNNING)

    expect(await startSpotlightServer({ repoId: REPO_ID, command: 'pnpm local' })).toEqual(BUSY)
    expect(fakePty.writes).toEqual([])
    expect(fakePty.inspectProcess).toHaveBeenCalledWith(PTY_ID, { observeForegroundGroup: true })
  })

  it('still gets typed into once the shell owns the prompt', async () => {
    expect(await startSpotlightServer({ repoId: REPO_ID, command: 'pnpm local' })).toEqual({
      ok: true,
      started: true
    })
    expect(writtenData()).toEqual(['pnpm local\r'])
  })

  it('gets the Ctrl-C when Spotlight turns off', async () => {
    fakePty.inspectProcess.mockResolvedValue(SHELL_SCRIPT_RUNNING)

    expect(await stopSpotlightServer(REPO_ID)).toBe(true)
    expect(writtenData()).toEqual([INTERRUPT])
  })

  it('counts as the queued line running, so a later switch may replace it', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    await prepareSpotlightServerLaunch(REPO_ID, 'pnpm local')
    fakePty.inspectProcess.mockResolvedValue(SHELL_SCRIPT_RUNNING)
    trackRegisteredSpotlightLaunch(REPO_ID, PTY_ID)

    await vi.advanceTimersByTimeAsync(QUEUED_LINE_RAN_MS + 2000)
    const switched = await startSpotlightServer({
      repoId: REPO_ID,
      command: 'pnpm dev',
      restartIfDifferent: true
    })

    expect(switched).toEqual({ ok: true, started: true, restarted: true })
    expect(writtenData()[0]).toBe(INTERRUPT)
  })

  it('keeps the stray-startup watch interrupting it after Spotlight turns off', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    await prepareSpotlightServerLaunch(REPO_ID, 'pnpm local')
    trackRegisteredSpotlightLaunch(REPO_ID, PTY_ID)
    // Still at the prompt at turn-off: the queued line has not reached the shell yet.
    expect(await stopSpotlightServer(REPO_ID)).toBe(false)

    fakePty.inspectProcess.mockResolvedValue(SHELL_SCRIPT_RUNNING)
    await vi.advanceTimersByTimeAsync(SPOTLIGHT_STRAY_STARTUP_WATCH_MS)

    expect(writtenData()).toContain(INTERRUPT)
  })
})

describe('a terminal on a daemon that predates the group reading (no foregroundGroup)', () => {
  beforeEach(() => {
    fakePty.inspectProcess.mockResolvedValue(OLD_DAEMON_ANSWER)
    fakePty.listProcesses.mockResolvedValue([
      { id: PTY_ID, rootProcessId: SPOTLIGHT_TERMINAL_ROOT_PID, cwd: root, title: 'shell' }
    ])
  })

  it('is never typed into while a sh script runs the server', async () => {
    readTable.mockResolvedValue(spotlightTerminalRows(true))

    expect(await startSpotlightServer({ repoId: REPO_ID, command: 'pnpm local' })).toEqual(BUSY)
    expect(fakePty.writes).toEqual([])
  })

  it('gets the server typed at its prompt', async () => {
    readTable.mockResolvedValue(spotlightTerminalRows(false))

    expect(await startSpotlightServer({ repoId: REPO_ID, command: 'pnpm local' })).toEqual({
      ok: true,
      started: true
    })
    expect(writtenData()).toEqual(['pnpm local\r'])
  })

  it('gets the Ctrl-C when Spotlight turns off while the script runs', async () => {
    readTable.mockResolvedValue(spotlightTerminalRows(true))

    expect(await stopSpotlightServer(REPO_ID)).toBe(true)
    expect(writtenData()).toEqual([INTERRUPT])
  })

  it('gets none at a free prompt', async () => {
    readTable.mockResolvedValue(spotlightTerminalRows(false))

    expect(await stopSpotlightServer(REPO_ID)).toBe(false)
    expect(fakePty.writes).toEqual([])
  })

  it('reads unknown without a pid: never typed into, Ctrl-C anyway at turn-off', async () => {
    fakePty.listProcesses.mockResolvedValue([])

    expect(await startSpotlightServer({ repoId: REPO_ID, command: 'pnpm local' })).toEqual(BUSY)
    expect(await stopSpotlightServer(REPO_ID)).toBe(true)
    expect(writtenData()).toEqual([INTERRUPT])
    expect(readTable).not.toHaveBeenCalled()
  })
})

describe('a Spotlight terminal whose PTY no longer exists', () => {
  beforeEach(() => {
    fakePty.inspectProcess.mockResolvedValue(UNREADABLE)
    fakePty.hasPty.mockReturnValue(false)
    fakePty.probePtyLiveness.mockResolvedValue(false)
  })

  it('answers terminal-gone and stops mirroring it', async () => {
    expect(await startSpotlightServer({ repoId: REPO_ID, command: 'pnpm local' })).toEqual({
      ok: false,
      reason: 'terminal-gone'
    })
    expect(fakePty.writes).toEqual([])
    expect(fakePty.probePtyLiveness).toHaveBeenCalledWith(PTY_ID)
    expect(getSpotlightTerminal(REPO_ID)).toBeNull()
  })

  it('stays busy when the host cannot say whether the PTY exists', async () => {
    fakePty.probePtyLiveness.mockResolvedValue(null)

    expect(await startSpotlightServer({ repoId: REPO_ID, command: 'pnpm local' })).toEqual(BUSY)
    expect(getSpotlightTerminal(REPO_ID)?.ptyId).toBe(PTY_ID)
  })

  it('never probes a live PTY that reads busy or idle', async () => {
    fakePty.hasPty.mockReturnValue(true)
    fakePty.inspectProcess.mockResolvedValue(SHELL_SCRIPT_RUNNING)
    expect(await startSpotlightServer({ repoId: REPO_ID, command: 'pnpm local' })).toEqual(BUSY)

    fakePty.inspectProcess.mockResolvedValue(AT_PROMPT)
    expect(await startSpotlightServer({ repoId: REPO_ID, command: 'pnpm local' })).toEqual({
      ok: true,
      started: true
    })
    expect(fakePty.probePtyLiveness).not.toHaveBeenCalled()
  })

  it('leaves a capture that moved to a new PTY meanwhile alone', async () => {
    let finishProbe: (live: boolean) => void = () => {}
    fakePty.probePtyLiveness.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          finishProbe = resolve
        })
    )

    const starting = startSpotlightServer({ repoId: REPO_ID, command: 'pnpm local' })
    await vi.waitFor(() => expect(fakePty.probePtyLiveness).toHaveBeenCalled())
    await startSpotlightLogCapture({ repoId: REPO_ID, ptyId: 'pty-2', rootPath: root })
    finishProbe(false)

    expect(await starting).toEqual({ ok: false, reason: 'no-terminal' })
    expect(getSpotlightTerminal(REPO_ID)?.ptyId).toBe('pty-2')
  })
})
