// Field case (AX-3447, 2026-10-10): after an app restart, reset's and sport-club's Spotlight shells
// sat at a free prompt in daemon sessions no pane had attached yet. The log mirror's attach was still
// in flight when the start read the terminal, the daemon adapter refused to inspect a session it
// didn't track yet, and the start silently typed nothing. Also: every start decision is noted.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import nodePath from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PtyProcessInspection } from '../providers/pty-process-inspection'
import type { PtyProcessInfo } from '../providers/types'

const fakePty = vi.hoisted(() => {
  const writes: { id: string; data: string }[] = []
  // Sessions the daemon adapter tracks: spawned or attached in this app run.
  const tracked = new Set<string>()
  return {
    writes,
    tracked,
    write: vi.fn((id: string, data: string): boolean => {
      writes.push({ id, data })
      return true
    }),
    hasChildProcesses: vi.fn(async (_id: string): Promise<boolean> => false),
    getForegroundProcess: vi.fn(async (_id: string): Promise<string | null> => 'zsh'),
    inspectProcess: vi.fn<(id: string, options?: unknown) => Promise<PtyProcessInspection>>(),
    hasPty: vi.fn((id: string): boolean => tracked.has(id)),
    probePtyLiveness: vi.fn(async (_id: string): Promise<boolean | null> => true),
    listProcesses: vi.fn(async (): Promise<PtyProcessInfo[]> => []),
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

import { startSpotlightLogCapture, stopSpotlightLogCapture } from './spotlight-log-mirror'
import { clearSpotlightInstallPending } from './spotlight-lockfile-install'
import { forgetSpotlightServerCommand } from './spotlight-server-commands'
import { prepareSpotlightServerLaunch, startSpotlightServer } from './spotlight-server-control'
import { noteSpotlightAutostart } from './spotlight-server-start-notes'
import { configureSpotlightTerminalOutputSource } from './spotlight-terminal-output-source'

const REPO_ID = 'reset'
const PTY_ID = 'pty-reset'
const COMMAND = 'pnpm local --port 3002'
const BUSY = { ok: true, started: false, reason: 'busy' }
const STARTED = { ok: true, started: true }
// The daemon answered the mirror's attach this long after the capture started (19 ms in the field).
const ATTACH_REPLY_MS = 40
const AT_PROMPT: PtyProcessInspection = {
  foregroundProcess: 'zsh',
  hasChildProcesses: false,
  foregroundGroup: 'shell'
}
const SERVER_RUNNING: PtyProcessInspection = {
  foregroundProcess: 'node',
  hasChildProcesses: true,
  foregroundGroup: 'job'
}

let root = ''

function writtenData(): string[] {
  return fakePty.writes.map((entry) => entry.data)
}

function spotlightLog(): string {
  try {
    return readFileSync(nodePath.join(root, '.orca', 'spotlight.log'), 'utf-8')
  } catch {
    return ''
  }
}

async function expectLogged(text: string): Promise<void> {
  await vi.waitFor(() => expect(spotlightLog()).toContain(text), { timeout: 1000, interval: 10 })
}

/** The runtime's observer: subscribing the log mirror attaches the daemon session asynchronously. */
function configureAttachingOutputSource(): void {
  configureSpotlightTerminalOutputSource({
    subscribeToTerminalData: () => () => {},
    registerTerminalOutputObserver: (ptyId) => {
      setTimeout(() => fakePty.tracked.add(ptyId), ATTACH_REPLY_MS)
      return () => {}
    }
  })
}

/** What the renderer does on activation: register the mirror, then ask main to start. */
async function activateWithLiveTerminal(): Promise<unknown> {
  await startSpotlightLogCapture({ repoId: REPO_ID, ptyId: PTY_ID, rootPath: root })
  return startSpotlightServer({ repoId: REPO_ID, command: COMMAND, restartIfDifferent: true })
}

beforeEach(() => {
  fakePty.writes.length = 0
  fakePty.tracked.clear()
  fakePty.write.mockClear()
  fakePty.inspectProcess.mockReset()
  fakePty.inspectProcess.mockResolvedValue(AT_PROMPT)
  fakePty.probePtyLiveness.mockReset()
  fakePty.probePtyLiveness.mockResolvedValue(true)
  fakePty.listProcesses.mockReset()
  fakePty.listProcesses.mockResolvedValue([])
  root = mkdtempSync(nodePath.join(tmpdir(), 'orca-spotlight-start-notes-'))
})

afterEach(async () => {
  vi.useRealTimers()
  configureSpotlightTerminalOutputSource(null)
  stopSpotlightLogCapture({ repoId: REPO_ID })
  forgetSpotlightServerCommand(REPO_ID)
  clearSpotlightInstallPending(REPO_ID)
  // Let fire-and-forget log notes land before the temp root goes away.
  await new Promise((resolve) => setTimeout(resolve, 50))
  rmSync(root, { recursive: true, force: true, maxRetries: 3 })
})

describe('a live daemon session the log mirror is still attaching (first activation after a restart)', () => {
  beforeEach(() => {
    configureAttachingOutputSource()
  })

  it('waits for the attach, then types the server at the free prompt', async () => {
    expect(await activateWithLiveTerminal()).toEqual(STARTED)

    expect(writtenData()).toEqual([`${COMMAND}\r`])
    expect(fakePty.inspectProcess).toHaveBeenCalledWith(PTY_ID, { observeForegroundGroup: true })
    await expectLogged(`Server started by Orca ("${COMMAND}")`)
  })

  it('still leaves a server it finds running there alone, and says so', async () => {
    fakePty.inspectProcess.mockResolvedValue(SERVER_RUNNING)

    expect(await activateWithLiveTerminal()).toEqual(BUSY)

    expect(fakePty.writes).toEqual([])
    await expectLogged('Server left alone — the Spotlight terminal is busy')
  })

  it('reads a session that never attaches as unreadable, and says so', async () => {
    configureSpotlightTerminalOutputSource(null)
    await startSpotlightLogCapture({ repoId: REPO_ID, ptyId: PTY_ID, rootPath: root })
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })

    const starting = startSpotlightServer({ repoId: REPO_ID, command: COMMAND })
    await vi.advanceTimersByTimeAsync(3500)

    expect(await starting).toEqual(BUSY)
    expect(fakePty.writes).toEqual([])
    vi.useRealTimers()
    await expectLogged("Server not started — the Spotlight terminal's state could not be read")
  })

  it('does not wait for a session the host says is gone', async () => {
    fakePty.probePtyLiveness.mockResolvedValue(false)

    expect(await activateWithLiveTerminal()).toEqual({ ok: false, reason: 'terminal-gone' })

    await expectLogged("Server not started — the Spotlight terminal's PTY no longer exists")
  })
})

describe('a start that types nothing into a tracked terminal', () => {
  beforeEach(async () => {
    fakePty.tracked.add(PTY_ID)
    await startSpotlightLogCapture({ repoId: REPO_ID, ptyId: PTY_ID, rootPath: root })
  })

  it("notes Orca's own server already running the same command", async () => {
    expect(await startSpotlightServer({ repoId: REPO_ID, command: COMMAND })).toEqual(STARTED)
    fakePty.inspectProcess.mockResolvedValue(SERVER_RUNNING)
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 5000 })

    const again = await startSpotlightServer({
      repoId: REPO_ID,
      command: COMMAND,
      restartIfDifferent: true
    })

    expect(again).toEqual(BUSY)
    vi.useRealTimers()
    await expectLogged("Server left alone — Orca's server for this command already runs there")
  })

  it('notes a line Orca typed moments ago', async () => {
    expect(await startSpotlightServer({ repoId: REPO_ID, command: COMMAND })).toEqual(STARTED)

    expect(await startSpotlightServer({ repoId: REPO_ID, command: COMMAND })).toEqual(BUSY)

    await expectLogged('Server left alone — Orca typed a server line there moments ago')
  })

  it('notes a queued line that is still on its way into the shell', async () => {
    await prepareSpotlightServerLaunch(REPO_ID, COMMAND)

    expect(await startSpotlightServer({ repoId: REPO_ID, command: COMMAND })).toEqual(BUSY)

    await expectLogged(
      'Server left alone — the server line queued for its terminal is still starting'
    )
  })

  it('notes a terminal whose state cannot be read (an old daemon without a pid)', async () => {
    fakePty.inspectProcess.mockResolvedValue({ foregroundProcess: null, hasChildProcesses: false })

    expect(await startSpotlightServer({ repoId: REPO_ID, command: COMMAND })).toEqual(BUSY)

    await expectLogged("Server not started — the Spotlight terminal's state could not be read")
  })
})

describe('notes the renderer reports', () => {
  it('quote the line main queued, install first, then mark it started when its pane spawns', async () => {
    fakePty.tracked.add(PTY_ID)
    await startSpotlightLogCapture({ repoId: REPO_ID, ptyId: PTY_ID, rootPath: root })
    // A root never installed: the queued line installs first.
    writeFileSync(nodePath.join(root, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n')
    const line = await prepareSpotlightServerLaunch(REPO_ID, COMMAND)
    expect(line).toBe(`pnpm install --frozen-lockfile && ${COMMAND}`)

    noteSpotlightAutostart(REPO_ID, root, { kind: 'queued' })
    noteSpotlightAutostart(REPO_ID, root, { kind: 'queued-started' })

    await expectLogged(`Server queued for a new Spotlight terminal ("${line}")`)
    await expectLogged(`Server started by Orca ("${line}")`)
  })

  it('say which command an environment lacks', async () => {
    noteSpotlightAutostart(REPO_ID, root, { kind: 'no-command', env: 'dev' })

    await expectLogged('Server not started — no command for Dev')
  })
})
