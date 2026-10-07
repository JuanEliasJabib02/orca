import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import nodePath from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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

import { SPOTLIGHT_STRAY_STARTUP_WATCH_MS } from '../../shared/spotlight-stray-startup'
import { startSpotlightLogCapture, stopSpotlightLogCapture } from './spotlight-log-mirror'
import {
  forgetSpotlightServerCommand,
  markPreparedSpotlightLaunchRegistered
} from './spotlight-server-commands'
import {
  interruptSpotlightServer,
  prepareSpotlightServerLaunch,
  resumeSpotlightServerControl,
  startSpotlightServer,
  stopSpotlightServer
} from './spotlight-server-control'

const REPO_ID = 'repo-1'
const PTY_ID = 'pty-1'
const INTERRUPT = String.fromCharCode(3)
const BUSY = { ok: true, started: false, reason: 'busy' }
const RESTART_RERUN_DELAY_MS = 700
// Long enough for a child to persist past the stray-startup rule's window.
const PERSISTED_MS = 3500

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
  root = mkdtempSync(nodePath.join(tmpdir(), 'orca-spotlight-queued-'))
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

  it('behaves normally once a busy reading shows the line ran', async () => {
    await queueRegisteredLaunch('pnpm local')
    vi.setSystemTime(Date.now() + 5000)
    childRunning = true

    const switched = await startSpotlightServer({
      repoId: REPO_ID,
      command: 'pnpm dev',
      restartIfDifferent: true
    })
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
})
