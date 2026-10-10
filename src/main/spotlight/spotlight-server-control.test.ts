import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import nodePath from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PtyProcessInspection } from '../providers/pty-process-inspection'

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
    confirmShellForeground: undefined as ((id: string) => Promise<boolean>) | undefined,
    onData: vi.fn(() => () => {})
  }
})

vi.mock('../ipc/pty', () => ({
  getLocalPtyProvider: () => fakePty,
  onLocalPtyProviderChanged: () => () => {}
}))
vi.mock('../pwsh', () => ({ isPwshAvailableAsync: vi.fn(async () => false) }))
vi.mock('../git/runner', () => ({
  gitExecFileAsync: vi.fn(async () => ({ stdout: '.git/info/exclude', stderr: '' }))
}))

import { inspectFakeSpotlightPty } from './spotlight-terminal-test-pty'
import {
  clearSpotlightInstallPending,
  isSpotlightInstallPending,
  markSpotlightInstallPending
} from './spotlight-lockfile-install'
import { startSpotlightLogCapture, stopSpotlightLogCapture } from './spotlight-log-mirror'
import { SPOTLIGHT_RESTART_TRIGGER_FILENAME } from './spotlight-restart-trigger'
import {
  forgetSpotlightServerCommand,
  getSpotlightServerCommand,
  getSpotlightServerLaunchedCommand,
  markPreparedSpotlightLaunchRegistered
} from './spotlight-server-commands'
import {
  cancelPreparedSpotlightServerLaunch,
  normalizeSpotlightServerCommand,
  prepareSpotlightServerLaunch,
  startSpotlightServer
} from './spotlight-server-control'
import {
  restartSpotlightServer,
  restartSpotlightServerForLockfileChange
} from './spotlight-server-restart'
import { stopSpotlightServer } from './spotlight-server-turn-off'
import { forgetSpotlightTerminalShell } from './spotlight-terminal-shell'

const REPO_ID = 'repo-1'
const PTY_ID = 'pty-1'
const INTERRUPT = String.fromCharCode(3)
const HISTORY_RECALL = '\u001b[A\r'
const RESTART_RERUN_DELAY_MS = 700
const INSTALL = 'pnpm install --frozen-lockfile && '
const LAUNCH_GRACE_MS = 2000
const QUEUED_LAUNCH_MAX_WAIT_MS = 35_000
// Busy readings this far apart show a queued line running, not a shell's rc child.
const QUEUED_LINE_RAN_MS = 2500
const BUSY = { ok: true, started: false, reason: 'busy' }

let root = ''

function writtenData(): string[] {
  return fakePty.writes.map((entry) => entry.data)
}

function spotlightLog(): string {
  return readFileSync(nodePath.join(root, '.orca', 'spotlight.log'), 'utf-8')
}

beforeEach(async () => {
  fakePty.writes.length = 0
  fakePty.write.mockClear()
  fakePty.hasChildProcesses.mockReset()
  fakePty.hasChildProcesses.mockResolvedValue(false)
  fakePty.getForegroundProcess.mockReset()
  fakePty.getForegroundProcess.mockResolvedValue('zsh')
  fakePty.inspectProcess.mockReset()
  fakePty.inspectProcess.mockImplementation((id: string) => inspectFakeSpotlightPty(fakePty, id))
  fakePty.confirmShellForeground = undefined
  root = mkdtempSync(nodePath.join(tmpdir(), 'orca-spotlight-server-'))
  await startSpotlightLogCapture({ repoId: REPO_ID, ptyId: PTY_ID, rootPath: root })
})

afterEach(async () => {
  vi.useRealTimers()
  stopSpotlightLogCapture({ repoId: REPO_ID })
  forgetSpotlightServerCommand(REPO_ID)
  forgetSpotlightTerminalShell(REPO_ID)
  clearSpotlightInstallPending(REPO_ID)
  // Let fire-and-forget log notes land before the temp root goes away.
  await new Promise((resolve) => setTimeout(resolve, 50))
  rmSync(root, { recursive: true, force: true, maxRetries: 3 })
})

describe('normalizeSpotlightServerCommand', () => {
  it('trims and keeps a one-line command', () => {
    expect(normalizeSpotlightServerCommand('  pnpm dev --port 3000 ')).toBe('pnpm dev --port 3000')
  })

  it('rejects empty, non-string, and control-character commands', () => {
    expect(normalizeSpotlightServerCommand('   ')).toBeNull()
    expect(normalizeSpotlightServerCommand(42)).toBeNull()
    expect(normalizeSpotlightServerCommand('pnpm dev\nrm -rf .')).toBeNull()
    expect(normalizeSpotlightServerCommand(`pnpm dev${INTERRUPT}`)).toBeNull()
  })
})

describe('startSpotlightServer', () => {
  it('types the command into an idle terminal', async () => {
    const result = await startSpotlightServer({ repoId: REPO_ID, command: 'pnpm dev' })

    expect(result).toEqual({ ok: true, started: true })
    expect(fakePty.hasChildProcesses).toHaveBeenCalledWith(PTY_ID)
    expect(fakePty.writes).toEqual([{ id: PTY_ID, data: 'pnpm dev\r' }])
    expect(getSpotlightServerCommand(REPO_ID)).toBe('pnpm dev')
  })

  it('leaves a busy terminal alone but keeps the command for restarts', async () => {
    fakePty.hasChildProcesses.mockResolvedValue(true)

    const result = await startSpotlightServer({ repoId: REPO_ID, command: 'pnpm dev' })

    expect(result).toEqual({ ok: true, started: false, reason: 'busy' })
    expect(fakePty.writes).toEqual([])
    expect(getSpotlightServerCommand(REPO_ID)).toBe('pnpm dev')
  })

  it('never types when the foreground check rejects', async () => {
    fakePty.hasChildProcesses.mockRejectedValue(new Error('inspection failed'))

    const result = await startSpotlightServer({ repoId: REPO_ID, command: 'pnpm dev' })

    expect(result).toEqual({ ok: true, started: false, reason: 'busy' })
    expect(fakePty.writes).toEqual([])
  })

  it('never types when the foreground check throws synchronously', async () => {
    fakePty.hasChildProcesses.mockImplementation(() => {
      throw new Error('provider gone')
    })

    const result = await startSpotlightServer({ repoId: REPO_ID, command: 'pnpm dev' })

    expect(result).toEqual({ ok: true, started: false, reason: 'busy' })
    expect(fakePty.writes).toEqual([])
  })

  it('reports no-terminal and keeps nothing when no Spotlight terminal is registered', async () => {
    const result = await startSpotlightServer({
      repoId: 'repo-without-terminal',
      command: 'pnpm dev'
    })

    expect(result).toEqual({ ok: false, reason: 'no-terminal' })
    expect(getSpotlightServerCommand('repo-without-terminal')).toBeUndefined()
    expect(fakePty.writes).toEqual([])
  })

  it('rejects an invalid command without touching the terminal', async () => {
    const result = await startSpotlightServer({ repoId: REPO_ID, command: 'pnpm dev\rrm -rf .' })

    expect(result).toEqual({ ok: false, reason: 'invalid-command' })
    expect(fakePty.hasChildProcesses).not.toHaveBeenCalled()
    expect(fakePty.writes).toEqual([])
  })

  it('does not start a server once Spotlight turns off during the check', async () => {
    let resolveCheck: (busy: boolean) => void = () => {}
    fakePty.hasChildProcesses.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          resolveCheck = resolve
        })
    )

    const starting = startSpotlightServer({ repoId: REPO_ID, command: 'pnpm dev' })
    await vi.waitFor(() => expect(fakePty.hasChildProcesses).toHaveBeenCalled())
    const stopping = stopSpotlightServer(REPO_ID)
    resolveCheck(false)
    await stopping

    expect(await starting).toEqual({ ok: false, reason: 'no-terminal' })
    expect(writtenData()).not.toContain('pnpm dev\r')
  })

  it('never types when the foreground cannot be read (the daemon answers null)', async () => {
    fakePty.getForegroundProcess.mockResolvedValue(null)

    expect(await startSpotlightServer({ repoId: REPO_ID, command: 'pnpm dev' })).toEqual(BUSY)
    expect(fakePty.writes).toEqual([])
  })

  it('never types when the foreground is not a shell, even without reported children', async () => {
    fakePty.getForegroundProcess.mockResolvedValue('node')

    expect(await startSpotlightServer({ repoId: REPO_ID, command: 'pnpm dev' })).toEqual(BUSY)
    expect(fakePty.writes).toEqual([])
  })

  it('types into a login shell', async () => {
    fakePty.getForegroundProcess.mockResolvedValue('-zsh')

    await startSpotlightServer({ repoId: REPO_ID, command: 'pnpm dev' })

    expect(writtenData()).toEqual(['pnpm dev\r'])
  })

  it('types exactly once for overlapping starts, though the shell has not forked yet', async () => {
    let resolveFirstCheck: (busy: boolean) => void = () => {}
    fakePty.hasChildProcesses.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          resolveFirstCheck = resolve
        })
    )

    const first = startSpotlightServer({ repoId: REPO_ID, command: 'pnpm dev' })
    const second = startSpotlightServer({
      repoId: REPO_ID,
      command: 'pnpm dev',
      restartIfDifferent: true
    })
    resolveFirstCheck(false)

    expect(await first).toEqual({ ok: true, started: true })
    expect(await second).toEqual(BUSY)
    expect(writtenData()).toEqual(['pnpm dev\r'])
  })

  it('types again once the launch grace has passed', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    await startSpotlightServer({ repoId: REPO_ID, command: 'pnpm dev' })
    vi.setSystemTime(Date.now() + LAUNCH_GRACE_MS)

    expect(await startSpotlightServer({ repoId: REPO_ID, command: 'pnpm dev' })).toEqual({
      ok: true,
      started: true
    })
    expect(writtenData()).toEqual(['pnpm dev\r', 'pnpm dev\r'])
  })
})

describe('restartSpotlightServer', () => {
  it('interrupts, then runs the given command and keeps it', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

    const result = restartSpotlightServer({ repoId: REPO_ID, command: 'pnpm local' })

    expect(result).toEqual({ ok: true, restarted: true })
    expect(writtenData()).toEqual([INTERRUPT])
    vi.advanceTimersByTime(RESTART_RERUN_DELAY_MS)
    expect(fakePty.writes).toEqual([
      { id: PTY_ID, data: INTERRUPT },
      { id: PTY_ID, data: 'pnpm local\r' }
    ])
    expect(getSpotlightServerCommand(REPO_ID)).toBe('pnpm local')
  })

  it('re-runs the stored command when none is given', async () => {
    fakePty.hasChildProcesses.mockResolvedValue(true)
    await startSpotlightServer({ repoId: REPO_ID, command: 'pnpm dev' })
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

    expect(restartSpotlightServer({ repoId: REPO_ID })).toEqual({ ok: true, restarted: true })
    vi.advanceTimersByTime(RESTART_RERUN_DELAY_MS)

    expect(writtenData()).toEqual([INTERRUPT, 'pnpm dev\r'])
  })

  it('falls back to history recall when no command is known', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

    expect(restartSpotlightServer({ repoId: REPO_ID })).toEqual({ ok: true, restarted: true })
    vi.advanceTimersByTime(RESTART_RERUN_DELAY_MS)

    expect(writtenData()).toEqual([INTERRUPT, HISTORY_RECALL])
  })

  it('folds a second restart into the pending one, which runs the newest command', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

    restartSpotlightServer({ repoId: REPO_ID, command: 'pnpm dev' })
    const second = restartSpotlightServer({ repoId: REPO_ID, command: 'pnpm local' })
    vi.advanceTimersByTime(RESTART_RERUN_DELAY_MS)

    expect(second).toEqual({ ok: true, restarted: false, reason: 'in-flight' })
    expect(writtenData()).toEqual([INTERRUPT, 'pnpm local\r'])
  })

  it('reports no-terminal without a Spotlight terminal', () => {
    expect(
      restartSpotlightServer({ repoId: 'repo-without-terminal', command: 'pnpm dev' })
    ).toEqual({ ok: false, reason: 'no-terminal' })
    expect(getSpotlightServerCommand('repo-without-terminal')).toBeUndefined()
  })

  it('rejects an invalid command', () => {
    expect(restartSpotlightServer({ repoId: REPO_ID, command: '' })).toEqual({
      ok: false,
      reason: 'invalid-command'
    })
    expect(fakePty.writes).toEqual([])
  })
})

describe('stopSpotlightServer', () => {
  it('interrupts a busy terminal', async () => {
    fakePty.hasChildProcesses.mockResolvedValue(true)

    expect(await stopSpotlightServer(REPO_ID)).toBe(true)
    expect(fakePty.writes).toEqual([{ id: PTY_ID, data: INTERRUPT }])
  })

  it('leaves an idle terminal alone', async () => {
    expect(await stopSpotlightServer(REPO_ID)).toBe(false)
    expect(fakePty.writes).toEqual([])
  })

  it('interrupts when the foreground cannot be read: Ctrl-C is harmless at a prompt', async () => {
    fakePty.getForegroundProcess.mockResolvedValue(null)

    expect(await stopSpotlightServer(REPO_ID)).toBe(true)
    expect(fakePty.writes).toEqual([{ id: PTY_ID, data: INTERRUPT }])
  })

  it('interrupts when the foreground check times out', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    fakePty.hasChildProcesses.mockReturnValue(new Promise<boolean>(() => {}))

    const stopping = stopSpotlightServer(REPO_ID)
    await vi.advanceTimersByTimeAsync(3000)

    expect(await stopping).toBe(true)
    expect(writtenData()).toEqual([INTERRUPT])
  })

  it('interrupts a server Orca typed moments ago, while the shell still looks idle', async () => {
    await startSpotlightServer({ repoId: REPO_ID, command: 'pnpm dev' })

    expect(await stopSpotlightServer(REPO_ID)).toBe(true)
    expect(writtenData()).toEqual(['pnpm dev\r', INTERRUPT])
  })

  it('forgets the command and blocks later writes, a pending restart re-run included', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    restartSpotlightServer({ repoId: REPO_ID, command: 'pnpm dev' })

    await stopSpotlightServer(REPO_ID)
    vi.advanceTimersByTime(RESTART_RERUN_DELAY_MS)

    expect(writtenData()).toEqual([INTERRUPT])
    expect(getSpotlightServerCommand(REPO_ID)).toBeUndefined()
    expect(await startSpotlightServer({ repoId: REPO_ID, command: 'pnpm dev' })).toEqual({
      ok: false,
      reason: 'no-terminal'
    })
    expect(restartSpotlightServer({ repoId: REPO_ID })).toEqual({
      ok: false,
      reason: 'no-terminal'
    })
  })
})

describe('a Windows terminal whose shell name proves nothing', () => {
  const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')

  beforeEach(() => {
    Object.defineProperty(process, 'platform', { configurable: true, value: 'win32' })
    fakePty.getForegroundProcess.mockResolvedValue('powershell.exe')
  })

  afterEach(() => {
    if (originalPlatform) {
      Object.defineProperty(process, 'platform', originalPlatform)
    }
  })

  it('never gets typed into without the host confirming the shell owns the foreground', async () => {
    expect(await startSpotlightServer({ repoId: REPO_ID, command: 'pnpm dev' })).toEqual(BUSY)
    fakePty.confirmShellForeground = async () => false
    expect(await startSpotlightServer({ repoId: REPO_ID, command: 'pnpm dev' })).toEqual(BUSY)
    expect(fakePty.writes).toEqual([])

    fakePty.confirmShellForeground = async () => true
    expect(await startSpotlightServer({ repoId: REPO_ID, command: 'pnpm dev' })).toEqual({
      ok: true,
      started: true
    })
  })

  it('gets the Ctrl-C when Spotlight turns off', async () => {
    expect(await stopSpotlightServer(REPO_ID)).toBe(true)
    expect(writtenData()).toEqual([INTERRUPT])
  })
})

describe('.orca/spotlight-restart trigger', () => {
  it('restarts with the stored command', async () => {
    fakePty.hasChildProcesses.mockResolvedValue(true)
    await startSpotlightServer({ repoId: REPO_ID, command: 'pnpm dev --port 3000' })

    mkdirSync(nodePath.join(root, '.orca'), { recursive: true })
    writeFileSync(nodePath.join(root, '.orca', SPOTLIGHT_RESTART_TRIGGER_FILENAME), '')

    await vi.waitFor(() => expect(writtenData()).toEqual([INTERRUPT, 'pnpm dev --port 3000\r']), {
      timeout: 3000,
      interval: 50
    })
  })
})

describe('pending install after a lockfile change', () => {
  it('installs before the command an idle start types, once', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    markSpotlightInstallPending(REPO_ID)

    await startSpotlightServer({ repoId: REPO_ID, command: 'pnpm dev' })
    vi.setSystemTime(Date.now() + LAUNCH_GRACE_MS)
    await startSpotlightServer({ repoId: REPO_ID, command: 'pnpm dev' })

    expect(writtenData()).toEqual([`${INSTALL}pnpm dev\r`, 'pnpm dev\r'])
    expect(getSpotlightServerCommand(REPO_ID)).toBe('pnpm dev')
  })

  it('chains the install for the Windows PowerShell 5.1 prompt it found', async () => {
    const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')
    Object.defineProperty(process, 'platform', { configurable: true, value: 'win32' })
    try {
      markSpotlightInstallPending(REPO_ID)
      fakePty.getForegroundProcess.mockResolvedValue('powershell.exe')
      fakePty.confirmShellForeground = async () => true

      await startSpotlightServer({ repoId: REPO_ID, command: 'pnpm dev' })

      expect(writtenData()).toEqual(['pnpm install --frozen-lockfile; if ($?) { pnpm dev }\r'])
    } finally {
      if (originalPlatform) {
        Object.defineProperty(process, 'platform', originalPlatform)
      }
    }
  })

  it('stays pending through a busy start and installs on the next restart', async () => {
    markSpotlightInstallPending(REPO_ID)
    fakePty.hasChildProcesses.mockResolvedValue(true)

    await startSpotlightServer({ repoId: REPO_ID, command: 'pnpm dev' })
    expect(isSpotlightInstallPending(REPO_ID)).toBe(true)

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    restartSpotlightServer({ repoId: REPO_ID })
    vi.advanceTimersByTime(RESTART_RERUN_DELAY_MS)

    expect(writtenData()).toEqual([INTERRUPT, `${INSTALL}pnpm dev\r`])
    expect(isSpotlightInstallPending(REPO_ID)).toBe(false)
  })

  it('stays pending through a history-recall restart', () => {
    markSpotlightInstallPending(REPO_ID)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

    restartSpotlightServer({ repoId: REPO_ID })
    vi.advanceTimersByTime(RESTART_RERUN_DELAY_MS)

    expect(writtenData()).toEqual([INTERRUPT, HISTORY_RECALL])
    expect(isSpotlightInstallPending(REPO_ID)).toBe(true)
  })

  it('stays pending when the start could not write', async () => {
    markSpotlightInstallPending(REPO_ID)
    fakePty.write.mockReturnValueOnce(false)

    expect(await startSpotlightServer({ repoId: REPO_ID, command: 'pnpm dev' })).toEqual({
      ok: false,
      reason: 'no-terminal'
    })
    expect(isSpotlightInstallPending(REPO_ID)).toBe(true)
  })

  it('is forgotten when Spotlight turns off', async () => {
    markSpotlightInstallPending(REPO_ID)

    await stopSpotlightServer(REPO_ID)

    expect(isSpotlightInstallPending(REPO_ID)).toBe(false)
  })
})

describe('prepareSpotlightServerLaunch', () => {
  it('returns the startup command with a pending install, once, and keeps the command', async () => {
    markSpotlightInstallPending(REPO_ID)

    expect(await prepareSpotlightServerLaunch(REPO_ID, '  pnpm local ')).toBe(
      `${INSTALL}pnpm local`
    )
    expect(await prepareSpotlightServerLaunch(REPO_ID, 'pnpm local')).toBe('pnpm local')
    expect(getSpotlightServerCommand(REPO_ID)).toBe('pnpm local')
    expect(fakePty.writes).toEqual([])
  })

  it('rejects an invalid command without consuming the install', async () => {
    markSpotlightInstallPending(REPO_ID)

    expect(await prepareSpotlightServerLaunch(REPO_ID, 'pnpm dev\nrm -rf .')).toBeNull()
    expect(isSpotlightInstallPending(REPO_ID)).toBe(true)
    expect(getSpotlightServerCommand(REPO_ID)).toBeUndefined()
  })

  it('chains the install for the default Windows shell, Windows PowerShell 5.1', async () => {
    const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')
    Object.defineProperty(process, 'platform', { configurable: true, value: 'win32' })
    try {
      markSpotlightInstallPending(REPO_ID)

      expect(await prepareSpotlightServerLaunch(REPO_ID, 'pnpm local')).toBe(
        'pnpm install --frozen-lockfile; if ($?) { pnpm local }'
      )
    } finally {
      if (originalPlatform) {
        Object.defineProperty(process, 'platform', originalPlatform)
      }
    }
  })
})

describe('a queued launch that may still be on its way into the shell', () => {
  it('keeps an environment switch from typing a second line before the PTY registers', async () => {
    await prepareSpotlightServerLaunch(REPO_ID, 'pnpm local')

    const result = await startSpotlightServer({
      repoId: REPO_ID,
      command: 'pnpm dev',
      restartIfDifferent: true
    })

    expect(result).toEqual(BUSY)
    expect(fakePty.writes).toEqual([])
    expect(fakePty.hasChildProcesses).not.toHaveBeenCalled()
  })

  it('keeps blocking for a grace after the PTY registers, without a restart', async () => {
    fakePty.hasChildProcesses.mockResolvedValue(true)
    await prepareSpotlightServerLaunch(REPO_ID, 'pnpm local')
    markPreparedSpotlightLaunchRegistered(REPO_ID)

    const result = await startSpotlightServer({
      repoId: REPO_ID,
      command: 'pnpm dev',
      restartIfDifferent: true
    })

    expect(result).toEqual(BUSY)
    expect(fakePty.writes).toEqual([])
  })

  it('lets an environment switch replace it once it ran', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    fakePty.hasChildProcesses.mockResolvedValue(true)
    await prepareSpotlightServerLaunch(REPO_ID, 'pnpm local')
    markPreparedSpotlightLaunchRegistered(REPO_ID)
    vi.setSystemTime(Date.now() + LAUNCH_GRACE_MS)
    const switchEnv = (): ReturnType<typeof startSpotlightServer> =>
      startSpotlightServer({ repoId: REPO_ID, command: 'pnpm dev', restartIfDifferent: true })

    expect(await switchEnv()).toEqual(BUSY)
    vi.setSystemTime(Date.now() + QUEUED_LINE_RAN_MS)
    const result = await switchEnv()
    vi.advanceTimersByTime(RESTART_RERUN_DELAY_MS)

    expect(result).toEqual({ ok: true, started: true, restarted: true })
    expect(writtenData()).toEqual([INTERRUPT, 'pnpm dev\r'])
  })

  it('stops blocking once cancelled', async () => {
    await prepareSpotlightServerLaunch(REPO_ID, 'pnpm local')

    cancelPreparedSpotlightServerLaunch(REPO_ID)

    expect(await startSpotlightServer({ repoId: REPO_ID, command: 'pnpm dev' })).toEqual({
      ok: true,
      started: true
    })
    expect(writtenData()).toEqual(['pnpm dev\r'])
  })

  it('stops blocking when its PTY never registers within the claim window', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    await prepareSpotlightServerLaunch(REPO_ID, 'pnpm local')
    vi.setSystemTime(Date.now() + QUEUED_LAUNCH_MAX_WAIT_MS)

    expect(await startSpotlightServer({ repoId: REPO_ID, command: 'pnpm dev' })).toEqual({
      ok: true,
      started: true
    })
  })
})

describe('cancelPreparedSpotlightServerLaunch', () => {
  it("takes back a queued line that never ran: not Orca's server, install pending again", async () => {
    markSpotlightInstallPending(REPO_ID)
    await prepareSpotlightServerLaunch(REPO_ID, 'pnpm local')

    cancelPreparedSpotlightServerLaunch(REPO_ID)

    expect(getSpotlightServerLaunchedCommand(REPO_ID)).toBeUndefined()
    expect(isSpotlightInstallPending(REPO_ID)).toBe(true)
    expect(getSpotlightServerCommand(REPO_ID)).toBe('pnpm local')
  })

  it('lets the fallback start install first', async () => {
    markSpotlightInstallPending(REPO_ID)
    await prepareSpotlightServerLaunch(REPO_ID, 'pnpm local')

    cancelPreparedSpotlightServerLaunch(REPO_ID)
    await startSpotlightServer({ repoId: REPO_ID, command: 'pnpm local' })

    expect(writtenData()).toEqual([`${INSTALL}pnpm local\r`])
  })

  it('does not put back an install the queued line never took', async () => {
    await prepareSpotlightServerLaunch(REPO_ID, 'pnpm local')

    cancelPreparedSpotlightServerLaunch(REPO_ID)

    expect(isSpotlightInstallPending(REPO_ID)).toBe(false)
  })

  it('is a no-op once Orca typed a line since', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    markSpotlightInstallPending(REPO_ID)
    await prepareSpotlightServerLaunch(REPO_ID, 'pnpm local')
    markPreparedSpotlightLaunchRegistered(REPO_ID)
    vi.setSystemTime(Date.now() + LAUNCH_GRACE_MS)
    // The queued line ran (busy readings that persist) and exited; then Orca types into the idle shell.
    fakePty.hasChildProcesses.mockResolvedValueOnce(true).mockResolvedValueOnce(true)
    await startSpotlightServer({ repoId: REPO_ID, command: 'pnpm local' })
    vi.setSystemTime(Date.now() + QUEUED_LINE_RAN_MS)
    await startSpotlightServer({ repoId: REPO_ID, command: 'pnpm local' })
    await startSpotlightServer({ repoId: REPO_ID, command: 'pnpm dev' })

    cancelPreparedSpotlightServerLaunch(REPO_ID)

    expect(getSpotlightServerLaunchedCommand(REPO_ID)).toBe('pnpm dev')
    expect(isSpotlightInstallPending(REPO_ID)).toBe(false)
  })

  it('is a no-op without a prepared launch', () => {
    cancelPreparedSpotlightServerLaunch(REPO_ID)

    expect(getSpotlightServerLaunchedCommand(REPO_ID)).toBeUndefined()
    expect(isSpotlightInstallPending(REPO_ID)).toBe(false)
  })
})

describe('restartSpotlightServerForLockfileChange', () => {
  it('restarts a running server Orca started, installing first', async () => {
    await startSpotlightServer({ repoId: REPO_ID, command: 'pnpm dev' })
    fakePty.writes.length = 0
    fakePty.hasChildProcesses.mockResolvedValue(true)
    markSpotlightInstallPending(REPO_ID)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

    await restartSpotlightServerForLockfileChange(REPO_ID)
    vi.advanceTimersByTime(RESTART_RERUN_DELAY_MS)

    expect(writtenData()).toEqual([INTERRUPT, `${INSTALL}pnpm dev\r`])
    expect(isSpotlightInstallPending(REPO_ID)).toBe(false)
  })

  it('never interrupts a server started by hand, even after a busy start kept a command', async () => {
    fakePty.hasChildProcesses.mockResolvedValue(true)
    await startSpotlightServer({ repoId: REPO_ID, command: 'pnpm dev' })
    markSpotlightInstallPending(REPO_ID)

    await restartSpotlightServerForLockfileChange(REPO_ID)

    expect(fakePty.writes).toEqual([])
    expect(isSpotlightInstallPending(REPO_ID)).toBe(true)
    await vi.waitFor(() => expect(spotlightLog()).toContain('pnpm-lock.yaml changed'), {
      timeout: 1000,
      interval: 20
    })
  })

  it('leaves an idle terminal for the next start', async () => {
    await prepareSpotlightServerLaunch(REPO_ID, 'pnpm dev')
    markSpotlightInstallPending(REPO_ID)

    await restartSpotlightServerForLockfileChange(REPO_ID)

    expect(fakePty.writes).toEqual([])
    expect(isSpotlightInstallPending(REPO_ID)).toBe(true)
  })

  it('only notes the change for a server started by hand', async () => {
    fakePty.hasChildProcesses.mockResolvedValue(true)
    markSpotlightInstallPending(REPO_ID)

    await restartSpotlightServerForLockfileChange(REPO_ID)

    expect(fakePty.writes).toEqual([])
    expect(isSpotlightInstallPending(REPO_ID)).toBe(true)
    await vi.waitFor(() => expect(spotlightLog()).toContain('pnpm-lock.yaml changed'), {
      timeout: 1000,
      interval: 20
    })
  })

  it('does not restart when a queued launch took the install during the busy check', async () => {
    await prepareSpotlightServerLaunch(REPO_ID, 'pnpm dev')
    markSpotlightInstallPending(REPO_ID)
    let resolveCheck: (busy: boolean) => void = () => {}
    fakePty.hasChildProcesses.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          resolveCheck = resolve
        })
    )

    const reacting = restartSpotlightServerForLockfileChange(REPO_ID)
    expect(await prepareSpotlightServerLaunch(REPO_ID, 'pnpm dev')).toBe(`${INSTALL}pnpm dev`)
    resolveCheck(true)
    await reacting

    expect(fakePty.writes).toEqual([])
  })

  it('waits for an overlapping start instead of racing it', async () => {
    let resolveStartCheck: (busy: boolean) => void = () => {}
    fakePty.hasChildProcesses.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          resolveStartCheck = resolve
        })
    )
    markSpotlightInstallPending(REPO_ID)

    const starting = startSpotlightServer({ repoId: REPO_ID, command: 'pnpm dev' })
    const reacting = restartSpotlightServerForLockfileChange(REPO_ID)
    resolveStartCheck(false)
    await starting
    await reacting

    // The start took the install, so the lockfile reaction finds nothing left to do.
    expect(writtenData()).toEqual([`${INSTALL}pnpm dev\r`])
  })
})

describe('startSpotlightServer with restartIfDifferent (takeover into another environment)', () => {
  async function startOrcaServer(command: string): Promise<void> {
    await startSpotlightServer({ repoId: REPO_ID, command })
    fakePty.writes.length = 0
    fakePty.hasChildProcesses.mockResolvedValue(true)
  }

  it('replaces the server Orca started with the new command', async () => {
    await startOrcaServer('pnpm local --port 3000')
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

    const result = await startSpotlightServer({
      repoId: REPO_ID,
      command: 'pnpm dev --port 3000',
      restartIfDifferent: true
    })
    vi.advanceTimersByTime(RESTART_RERUN_DELAY_MS)

    expect(result).toEqual({ ok: true, started: true, restarted: true })
    expect(writtenData()).toEqual([INTERRUPT, 'pnpm dev --port 3000\r'])
    expect(getSpotlightServerLaunchedCommand(REPO_ID)).toBe('pnpm dev --port 3000')
  })

  it('leaves the running server alone for the same command', async () => {
    await startOrcaServer('pnpm local --port 3000')

    const result = await startSpotlightServer({
      repoId: REPO_ID,
      command: 'pnpm local --port 3000',
      restartIfDifferent: true
    })

    expect(result).toEqual({ ok: true, started: false, reason: 'busy' })
    expect(fakePty.writes).toEqual([])
  })

  it('never touches a server started by hand, even after a busy start kept a command', async () => {
    fakePty.hasChildProcesses.mockResolvedValue(true)
    await startSpotlightServer({ repoId: REPO_ID, command: 'pnpm local', restartIfDifferent: true })

    const result = await startSpotlightServer({
      repoId: REPO_ID,
      command: 'pnpm dev',
      restartIfDifferent: true
    })

    expect(result).toEqual({ ok: true, started: false, reason: 'busy' })
    expect(fakePty.writes).toEqual([])
    expect(getSpotlightServerLaunchedCommand(REPO_ID)).toBeUndefined()
  })

  it('keeps a different running command without the option', async () => {
    await startOrcaServer('pnpm local')

    const result = await startSpotlightServer({ repoId: REPO_ID, command: 'pnpm dev' })

    expect(result).toEqual({ ok: true, started: false, reason: 'busy' })
    expect(fakePty.writes).toEqual([])
  })

  it('counts a queued startup command as started by Orca', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    await prepareSpotlightServerLaunch(REPO_ID, 'pnpm local')
    markPreparedSpotlightLaunchRegistered(REPO_ID)
    vi.setSystemTime(Date.now() + LAUNCH_GRACE_MS)
    fakePty.hasChildProcesses.mockResolvedValue(true)
    // The first busy reading starts the run that shows the queued line running.
    await startSpotlightServer({ repoId: REPO_ID, command: 'pnpm local' })
    vi.setSystemTime(Date.now() + QUEUED_LINE_RAN_MS)

    const result = await startSpotlightServer({
      repoId: REPO_ID,
      command: 'pnpm dev',
      restartIfDifferent: true
    })
    vi.advanceTimersByTime(RESTART_RERUN_DELAY_MS)

    expect(result).toEqual({ ok: true, started: true, restarted: true })
    expect(writtenData()).toEqual([INTERRUPT, 'pnpm dev\r'])
  })

  it('counts a restart that re-ran the stored command as started by Orca', async () => {
    fakePty.hasChildProcesses.mockResolvedValue(true)
    await startSpotlightServer({ repoId: REPO_ID, command: 'pnpm local' })
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    restartSpotlightServer({ repoId: REPO_ID })
    vi.advanceTimersByTime(RESTART_RERUN_DELAY_MS)

    expect(getSpotlightServerLaunchedCommand(REPO_ID)).toBe('pnpm local')
  })

  it('forgets what Orca ran when Spotlight turns off', async () => {
    await startSpotlightServer({ repoId: REPO_ID, command: 'pnpm local' })

    await stopSpotlightServer(REPO_ID)

    expect(getSpotlightServerLaunchedCommand(REPO_ID)).toBeUndefined()
  })
})
