import { mkdtempSync, rmSync } from 'node:fs'
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
import { SPOTLIGHT_STRAY_STARTUP_WATCH_MS } from '../../shared/spotlight-stray-startup'
import { startSpotlightLogCapture, stopSpotlightLogCapture } from './spotlight-log-mirror'
import {
  forgetSpotlightServerCommand,
  markPreparedSpotlightLaunchRegistered
} from './spotlight-server-commands'
import {
  prepareSpotlightServerLaunch,
  startSpotlightServer,
  trackRegisteredSpotlightLaunch
} from './spotlight-server-control'
import {
  interruptSpotlightServer,
  resumeSpotlightServerControl,
  stopSpotlightServer,
  watchLateSpotlightTerminal
} from './spotlight-server-turn-off'

const REPO_ID = 'repo-1'
const PTY_ID = 'pty-1'
const INTERRUPT = String.fromCharCode(3)
const BUSY = { ok: true, started: false, reason: 'busy' }
const RESTART_RERUN_DELAY_MS = 700
// Long enough for a child to persist past the stray-startup rule's window.
const PERSISTED_MS = 3500
// Busy readings this far apart show a queued line running, not a shell's rc child.
const QUEUED_LINE_RAN_MS = 2500
const QUEUED_LAUNCH_MAX_WAIT_MS = 35_000
const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')

let root = ''
let childRunning = false

function writtenData(): string[] {
  return fakePty.writes.map((entry) => entry.data)
}

/** A queued line whose PTY registered: the shell may still be starting when it runs. */
async function queueRegisteredLaunch(command = 'pnpm local'): Promise<void> {
  await prepareSpotlightServerLaunch(REPO_ID, command)
  markPreparedSpotlightLaunchRegistered(REPO_ID)
}

function switchToDev(): ReturnType<typeof startSpotlightServer> {
  return startSpotlightServer({ repoId: REPO_ID, command: 'pnpm dev', restartIfDifferent: true })
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  childRunning = false
  fakePty.writes.length = 0
  fakePty.write.mockClear()
  // A Ctrl-C ends whatever runs.
  fakePty.write.mockImplementation((id: string, data: string): boolean => {
    fakePty.writes.push({ id, data })
    if (data === INTERRUPT) {
      childRunning = false
    }
    return true
  })
  fakePty.hasChildProcesses.mockReset()
  fakePty.hasChildProcesses.mockImplementation(async () => childRunning)
  fakePty.getForegroundProcess.mockReset()
  fakePty.getForegroundProcess.mockResolvedValue('zsh')
  fakePty.inspectProcess.mockReset()
  fakePty.inspectProcess.mockImplementation((id: string) => inspectFakeSpotlightPty(fakePty, id))
  root = mkdtempSync(nodePath.join(tmpdir(), 'orca-spotlight-queued-'))
  await startSpotlightLogCapture({ repoId: REPO_ID, ptyId: PTY_ID, rootPath: root })
})

afterEach(async () => {
  if (originalPlatform) {
    Object.defineProperty(process, 'platform', originalPlatform)
  }
  vi.useRealTimers()
  stopSpotlightLogCapture({ repoId: REPO_ID })
  forgetSpotlightServerCommand(REPO_ID)
  // Let fire-and-forget log notes land before the temp root goes away.
  await new Promise((resolve) => setTimeout(resolve, 50))
  rmSync(root, { recursive: true, force: true, maxRetries: 3 })
})

describe('a queued line behind a slow shell startup', () => {
  it('keeps an environment switch from typing until the line is seen running', async () => {
    await queueRegisteredLaunch('pnpm local')
    vi.setSystemTime(Date.now() + 5000)

    const switched = await startSpotlightServer({
      repoId: REPO_ID,
      command: 'pnpm dev',
      restartIfDifferent: true
    })

    expect(switched).toEqual(BUSY)
    expect(fakePty.writes).toEqual([])
  })

  it('keeps waiting after one busy blip, which may be an rc-file child', async () => {
    await queueRegisteredLaunch('pnpm local')
    vi.setSystemTime(Date.now() + 5000)

    childRunning = true
    expect(await switchToDev()).toEqual(BUSY)
    childRunning = false
    vi.setSystemTime(Date.now() + QUEUED_LINE_RAN_MS)
    expect(await switchToDev()).toEqual(BUSY)
    childRunning = true
    expect(await switchToDev()).toEqual(BUSY)

    expect(fakePty.writes).toEqual([])
  })

  it('behaves normally once busy readings persist, showing the line ran', async () => {
    await queueRegisteredLaunch('pnpm local')
    vi.setSystemTime(Date.now() + 5000)
    childRunning = true

    expect(await switchToDev()).toEqual(BUSY)
    vi.setSystemTime(Date.now() + QUEUED_LINE_RAN_MS)
    const switched = await switchToDev()
    await vi.advanceTimersByTimeAsync(RESTART_RERUN_DELAY_MS)

    expect(switched).toEqual({ ok: true, started: true, restarted: true })
    expect(writtenData()).toEqual([INTERRUPT, 'pnpm dev\r'])
  })

  it('stops waiting once the queued launch cap passes', async () => {
    await queueRegisteredLaunch('pnpm local')
    vi.setSystemTime(Date.now() + 35_000)

    expect(await startSpotlightServer({ repoId: REPO_ID, command: 'pnpm dev' })).toEqual({
      ok: true,
      started: true
    })
  })
})

describe('Spotlight off while a queued line may still wait in the shell startup', () => {
  it('interrupts the line once it runs as a persistent child', async () => {
    await queueRegisteredLaunch()

    // The shell is still starting: it reads idle, so no Ctrl-C yet.
    expect(await stopSpotlightServer(REPO_ID)).toBe(false)
    childRunning = true
    await vi.advanceTimersByTimeAsync(PERSISTED_MS)

    expect(writtenData()).toEqual([INTERRUPT])
    await vi.advanceTimersByTimeAsync(SPOTLIGHT_STRAY_STARTUP_WATCH_MS)
    expect(writtenData()).toEqual([INTERRUPT])
  })

  it('leaves a startup-file child that exits alone', async () => {
    await queueRegisteredLaunch()
    await stopSpotlightServer(REPO_ID)

    childRunning = true
    await vi.advanceTimersByTimeAsync(1500)
    childRunning = false
    await vi.advanceTimersByTimeAsync(SPOTLIGHT_STRAY_STARTUP_WATCH_MS)

    expect(fakePty.writes).toEqual([])
  })

  it('stops watching when the turn-off fails and Spotlight stays on', async () => {
    await queueRegisteredLaunch()

    expect(await interruptSpotlightServer(REPO_ID)).toBe(false)
    resumeSpotlightServerControl(REPO_ID, root, false)
    childRunning = true
    await vi.advanceTimersByTimeAsync(PERSISTED_MS * 2)

    expect(fakePty.writes).toEqual([])
  })

  it('does not watch a terminal without a queued line', async () => {
    await stopSpotlightServer(REPO_ID)

    childRunning = true
    await vi.advanceTimersByTimeAsync(PERSISTED_MS * 2)

    expect(fakePty.writes).toEqual([])
  })

  it('does not watch once the queued launch cap passed, so a command run after the turn-off is safe', async () => {
    await queueRegisteredLaunch()
    vi.setSystemTime(Date.now() + QUEUED_LAUNCH_MAX_WAIT_MS)
    // The queued line ran long ago; its server is what the turn-off interrupts.
    childRunning = true

    expect(await stopSpotlightServer(REPO_ID)).toBe(true)
    // The user starts something in the terminal right after.
    childRunning = true
    await vi.advanceTimersByTimeAsync(PERSISTED_MS * 2)

    expect(writtenData()).toEqual([INTERRUPT])
  })

  it('does not watch once the registered terminal was seen running the line', async () => {
    await prepareSpotlightServerLaunch(REPO_ID, 'pnpm local')
    trackRegisteredSpotlightLaunch(REPO_ID, PTY_ID)
    childRunning = true
    await vi.advanceTimersByTimeAsync(PERSISTED_MS + 1000)
    // The server exited on its own (e.g. a busy port) before Spotlight turned off.
    childRunning = false

    expect(await stopSpotlightServer(REPO_ID)).toBe(false)
    childRunning = true
    await vi.advanceTimersByTimeAsync(PERSISTED_MS * 2)

    expect(fakePty.writes).toEqual([])
  })

  it('counts its own Ctrl-C, so a child that outlives it gets one follow-up at most', async () => {
    await queueRegisteredLaunch()
    // The child ignores Ctrl-C (e.g. a server still shutting down).
    fakePty.write.mockImplementation((id: string, data: string): boolean => {
      fakePty.writes.push({ id, data })
      return true
    })
    childRunning = true

    expect(await stopSpotlightServer(REPO_ID)).toBe(true)
    expect(writtenData()).toEqual([INTERRUPT])
    await vi.advanceTimersByTimeAsync(PERSISTED_MS)
    expect(writtenData()).toEqual([INTERRUPT, INTERRUPT])
    await vi.advanceTimersByTimeAsync(SPOTLIGHT_STRAY_STARTUP_WATCH_MS)

    expect(writtenData()).toEqual([INTERRUPT, INTERRUPT])
  })

  it('interrupts on a Windows daemon, whose readings never prove the prompt is free', async () => {
    Object.defineProperty(process, 'platform', { configurable: true, value: 'win32' })
    // The daemon reports the spawned shell and no children, whatever runs.
    fakePty.getForegroundProcess.mockResolvedValue('powershell.exe')
    fakePty.hasChildProcesses.mockResolvedValue(false)
    await queueRegisteredLaunch()

    expect(await stopSpotlightServer(REPO_ID)).toBe(true)
    await vi.advanceTimersByTimeAsync(1000)
    expect(writtenData()).toEqual([INTERRUPT])
    await vi.advanceTimersByTimeAsync(PERSISTED_MS)

    expect(writtenData()).toEqual([INTERRUPT, INTERRUPT])
  })
})

describe('a Spotlight terminal that registers while Spotlight turns off', () => {
  const LATE_PTY_ID = 'pty-late'

  it('is watched when the turn-off left a queued line waiting for its PTY, once', async () => {
    await prepareSpotlightServerLaunch(REPO_ID, 'pnpm local')
    await stopSpotlightServer(REPO_ID)

    watchLateSpotlightTerminal(REPO_ID, LATE_PTY_ID)
    childRunning = true
    await vi.advanceTimersByTimeAsync(PERSISTED_MS)

    expect(fakePty.writes).toEqual([{ id: LATE_PTY_ID, data: INTERRUPT }])
    watchLateSpotlightTerminal(REPO_ID, 'pty-other')
    childRunning = true
    await vi.advanceTimersByTimeAsync(PERSISTED_MS * 2)
    expect(fakePty.writes).toEqual([{ id: LATE_PTY_ID, data: INTERRUPT }])
  })

  it('is left alone when no queued line was waiting for its PTY', async () => {
    await stopSpotlightServer(REPO_ID)

    watchLateSpotlightTerminal(REPO_ID, LATE_PTY_ID)
    childRunning = true
    await vi.advanceTimersByTimeAsync(PERSISTED_MS * 2)

    expect(fakePty.writes).toEqual([])
  })

  it('is left alone when the queued line already had its shell', async () => {
    await queueRegisteredLaunch()
    await stopSpotlightServer(REPO_ID)

    watchLateSpotlightTerminal(REPO_ID, LATE_PTY_ID)
    childRunning = true
    await vi.advanceTimersByTimeAsync(PERSISTED_MS * 2)

    expect(fakePty.writes.filter((entry) => entry.id === LATE_PTY_ID)).toEqual([])
  })
})
