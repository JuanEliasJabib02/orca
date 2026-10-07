import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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
    onData: vi.fn(() => () => {})
  }
})

vi.mock('../ipc/pty', () => ({
  getLocalPtyProvider: () => fakePty,
  onLocalPtyProviderChanged: () => () => {}
}))
vi.mock('../git/runner', () => ({
  gitExecFileAsync: vi.fn(async () => ({ stdout: '.git/info/exclude', stderr: '' }))
}))

import { startSpotlightLogCapture, stopSpotlightLogCapture } from './spotlight-log-mirror'
import { SPOTLIGHT_RESTART_TRIGGER_FILENAME } from './spotlight-restart-trigger'
import {
  forgetSpotlightServerCommand,
  getSpotlightServerCommand
} from './spotlight-server-commands'
import {
  normalizeSpotlightServerCommand,
  restartSpotlightServer,
  startSpotlightServer,
  stopSpotlightServer
} from './spotlight-server-control'

const REPO_ID = 'repo-1'
const PTY_ID = 'pty-1'
const INTERRUPT = String.fromCharCode(3)
const HISTORY_RECALL = '\u001b[A\r'
const RESTART_RERUN_DELAY_MS = 700

let root = ''

function writtenData(): string[] {
  return fakePty.writes.map((entry) => entry.data)
}

beforeEach(async () => {
  fakePty.writes.length = 0
  fakePty.write.mockClear()
  fakePty.hasChildProcesses.mockReset()
  fakePty.hasChildProcesses.mockResolvedValue(false)
  root = mkdtempSync(nodePath.join(tmpdir(), 'orca-spotlight-server-'))
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
    await stopSpotlightServer(REPO_ID)
    resolveCheck(false)

    expect(await starting).toEqual({ ok: false, reason: 'no-terminal' })
    expect(writtenData()).not.toContain('pnpm dev\r')
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
