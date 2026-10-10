// Field case: a Spotlight root never installed (no node_modules) failed its server with
// `next: command not found`. Every line Orca types or queues there installs first.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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

import {
  clearSpotlightInstallPending,
  isSpotlightInstallPending,
  markSpotlightInstallPending
} from './spotlight-lockfile-install'
import { startSpotlightLogCapture, stopSpotlightLogCapture } from './spotlight-log-mirror'
import { forgetSpotlightServerCommand } from './spotlight-server-commands'
import {
  cancelPreparedSpotlightServerLaunch,
  prepareSpotlightServerLaunch,
  startSpotlightServer,
  trackRegisteredSpotlightLaunch
} from './spotlight-server-control'
import { restartSpotlightServer } from './spotlight-server-restart'
import { forgetSpotlightTerminalShell } from './spotlight-terminal-shell'
import { inspectFakeSpotlightPty } from './spotlight-terminal-test-pty'

const REPO_ID = 'repo-deps'
const PTY_ID = 'pty-deps'
const INTERRUPT = String.fromCharCode(3)
const INSTALL = 'pnpm install --frozen-lockfile && '
const RESTART_RERUN_DELAY_MS = 700

let root = ''

function writtenData(): string[] {
  return fakePty.writes.map((entry) => entry.data)
}

function installDependencies(): void {
  mkdirSync(nodePath.join(root, 'node_modules'))
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
  // A pnpm repo whose root has never run `pnpm install`.
  root = mkdtempSync(nodePath.join(tmpdir(), 'orca-spotlight-deps-'))
  writeFileSync(nodePath.join(root, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n')
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

describe('a start typed into a root without node_modules', () => {
  it('installs first, and stops once the dependencies exist', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })

    await startSpotlightServer({ repoId: REPO_ID, command: 'pnpm local' })
    installDependencies()
    vi.setSystemTime(Date.now() + 2000)
    await startSpotlightServer({ repoId: REPO_ID, command: 'pnpm local' })

    expect(writtenData()).toEqual([`${INSTALL}pnpm local\r`, 'pnpm local\r'])
  })

  it('chains one install when a lockfile change is pending too', async () => {
    markSpotlightInstallPending(REPO_ID, ['pnpm'])

    await startSpotlightServer({ repoId: REPO_ID, command: 'pnpm local' })

    expect(writtenData()).toEqual([`${INSTALL}pnpm local\r`])
    expect(isSpotlightInstallPending(REPO_ID)).toBe(false)
  })

  it('leaves no install pending when the line could not be written', async () => {
    fakePty.write.mockReturnValueOnce(false)

    expect(await startSpotlightServer({ repoId: REPO_ID, command: 'pnpm local' })).toEqual({
      ok: false,
      reason: 'no-terminal'
    })
    expect(isSpotlightInstallPending(REPO_ID)).toBe(false)
  })
})

describe('a launch queued for a terminal that does not exist yet', () => {
  it('installs first in the root Orca last saw for the repo', async () => {
    // The tab's terminal is respawning: no capture, only the root an earlier start saw.
    await startSpotlightServer({ repoId: REPO_ID, command: 'pnpm local' })
    stopSpotlightLogCapture({ repoId: REPO_ID })
    fakePty.writes.length = 0

    expect(await prepareSpotlightServerLaunch(REPO_ID, 'pnpm local')).toBe(`${INSTALL}pnpm local`)
    installDependencies()
    expect(await prepareSpotlightServerLaunch(REPO_ID, 'pnpm local')).toBe('pnpm local')
    expect(writtenData()).toEqual([])
  })

  it('puts back nothing when cancelled, since the disk is read again', async () => {
    expect(await prepareSpotlightServerLaunch(REPO_ID, 'pnpm local')).toBe(`${INSTALL}pnpm local`)

    cancelPreparedSpotlightServerLaunch(REPO_ID)

    expect(isSpotlightInstallPending(REPO_ID)).toBe(false)
  })
})

describe('a root with uv.lock too (a Python server next to the front)', () => {
  it('syncs uv after pnpm when neither install exists yet', async () => {
    writeFileSync(nodePath.join(root, 'uv.lock'), 'version = 1\n')

    await startSpotlightServer({ repoId: REPO_ID, command: 'pnpm local' })

    expect(writtenData()).toEqual([`${INSTALL}uv sync --frozen && pnpm local\r`])
  })

  it('hands back the uv sync a cancelled queued line took', async () => {
    installDependencies()
    markSpotlightInstallPending(REPO_ID, ['uv'])
    expect(await prepareSpotlightServerLaunch(REPO_ID, 'pnpm local')).toBe(
      'uv sync --frozen && pnpm local'
    )
    expect(isSpotlightInstallPending(REPO_ID)).toBe(false)

    cancelPreparedSpotlightServerLaunch(REPO_ID)

    expect(isSpotlightInstallPending(REPO_ID)).toBe(true)
    expect(await prepareSpotlightServerLaunch(REPO_ID, 'pnpm local')).toBe(
      'uv sync --frozen && pnpm local'
    )
  })
})

describe("a restart's re-run in a root without node_modules", () => {
  it('installs first, using the root its terminal registered with', async () => {
    trackRegisteredSpotlightLaunch(REPO_ID, PTY_ID)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

    restartSpotlightServer({ repoId: REPO_ID, command: 'pnpm local' })
    vi.advanceTimersByTime(RESTART_RERUN_DELAY_MS)

    expect(writtenData()).toEqual([INTERRUPT, `${INSTALL}pnpm local\r`])
  })
})
