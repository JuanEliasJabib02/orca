// Field case (AX-3447, 2026-10-09): the backend's `ax-dev-back` (uvicorn --reload) reloaded into a
// branch whose uv.lock added pypdf and crashed on the import, since a reload never installs. A
// takeover or sync that changes uv.lock restarts Orca's server with `uv sync --frozen` first.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import nodePath from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PtyProcessInspection } from '../providers/pty-process-inspection'
import type { SpotlightRepoState } from '../../shared/spotlight'
import type * as SpotlightSyncCore from '../../shared/spotlight-sync-core'
import type { Store } from '../persistence'

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

// Git as the lockfile check sees it: which lockfiles differ, and every call made.
const fakeGit = vi.hoisted(() => ({
  calls: [] as string[][],
  changed: ['uv.lock'] as string[]
}))

const core = vi.hoisted(() => ({
  activateSpotlightCore: vi.fn(),
  syncSpotlightCore: vi.fn()
}))

vi.mock('../ipc/pty', () => ({
  getLocalPtyProvider: () => fakePty,
  onLocalPtyProviderChanged: () => () => {}
}))
vi.mock('../git/runner', () => ({
  gitExecFileAsync: vi.fn(async () => ({ stdout: '.git/info/exclude', stderr: '' }))
}))
vi.mock('../git/spotlight-sync', () => ({
  createLocalSpotlightGitContext: () => ({
    git: async (args: string[]) => {
      fakeGit.calls.push(args)
      if (args[0] === 'diff-tree') {
        return { stdout: fakeGit.changed.map((path) => `${path}\n`).join(''), stderr: '' }
      }
      return { stdout: `${'c'.repeat(40)}\n`, stderr: '' }
    },
    detectConflict: async () => 'unknown'
  })
}))
vi.mock('./spotlight-state-file', () => ({
  writeSpotlightStateFile: vi.fn(async () => {})
}))
vi.mock('../../shared/spotlight-sync-core', async (importOriginal) => ({
  ...(await importOriginal<typeof SpotlightSyncCore>()),
  activateSpotlightCore: core.activateSpotlightCore,
  syncSpotlightCore: core.syncSpotlightCore
}))

import { inspectFakeSpotlightPty } from './spotlight-terminal-test-pty'
import {
  clearSpotlightInstallPending,
  isSpotlightInstallPending
} from './spotlight-lockfile-install'
import { startSpotlightLogCapture, stopSpotlightLogCapture } from './spotlight-log-mirror'
import { forgetSpotlightServerCommand } from './spotlight-server-commands'
import { startSpotlightServer } from './spotlight-server-control'
import { SpotlightService } from './spotlight-service'

const REPO_ID = 'backend'
const PTY_ID = 'pty-backend'
const COMMAND = 'ax-dev-back'
const INTERRUPT = String.fromCharCode(3)
const BACKUP_SHA = 'a'.repeat(40)
const PREVIOUS_SNAPSHOT_SHA = 'b'.repeat(40)
const NEW_SNAPSHOT_SHA = 'd'.repeat(40)
const HOLDER = `${REPO_ID}::/tmp/AX-3423`
const NEXT_HOLDER = `${REPO_ID}::/tmp/AX-3447`

let root = ''
let state: SpotlightRepoState | null = null

function createService(): SpotlightService {
  const store = {
    getRepo: (repoId: string) =>
      repoId === REPO_ID ? { id: REPO_ID, path: root, spotlightTestingEnabled: true } : undefined,
    getSpotlightState: () => state,
    getAllSpotlightStates: () => (state ? { [REPO_ID]: state } : {}),
    setSpotlightState: (_repoId: string, next: SpotlightRepoState) => {
      state = next
    },
    clearSpotlightState: () => {
      state = null
    }
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: activate and sync only read the repo and the Spotlight record, both faked above.
  return new SpotlightService(store as unknown as Store, () => null)
}

function activeState(): SpotlightRepoState {
  return {
    repoId: REPO_ID,
    holderWorktreeId: HOLDER,
    status: 'active',
    originalBranch: 'main',
    originalHeadSha: BACKUP_SHA,
    backupSha: BACKUP_SHA,
    lastSnapshotSha: PREVIOUS_SNAPSHOT_SHA,
    activatedAt: 1,
    lastSyncAt: null,
    lastError: null
  }
}

function activation(alreadyActive: boolean): SpotlightSyncCore.SpotlightActivateOutcome {
  return {
    snapshotSha: NEW_SNAPSHOT_SHA,
    checkpointHeadSha: 'e'.repeat(40),
    originalBranch: 'main',
    originalHeadSha: BACKUP_SHA,
    backupSha: BACKUP_SHA,
    alreadyActive
  }
}

function mirroredSync(): SpotlightSyncCore.SpotlightSyncOutcome {
  return { snapshotSha: NEW_SNAPSHOT_SHA, checkpointHeadSha: 'e'.repeat(40), skipped: false }
}

function writtenData(): string[] {
  return fakePty.writes.map((entry) => entry.data)
}

/** `ax-dev-back`, typed by Orca into the idle terminal earlier and running now. */
async function runOrcaServer(): Promise<void> {
  await startSpotlightServer({ repoId: REPO_ID, command: COMMAND })
  fakePty.writes.length = 0
  fakePty.hasChildProcesses.mockResolvedValue(true)
}

async function expectRestartedWith(line: string): Promise<void> {
  await vi.waitFor(() => expect(writtenData()).toEqual([INTERRUPT, `${line}\r`]), {
    timeout: 3000,
    interval: 50
  })
}

beforeEach(async () => {
  fakePty.writes.length = 0
  fakePty.hasChildProcesses.mockReset()
  fakePty.hasChildProcesses.mockResolvedValue(false)
  fakePty.inspectProcess.mockReset()
  fakePty.inspectProcess.mockImplementation((id: string) => inspectFakeSpotlightPty(fakePty, id))
  fakeGit.calls.length = 0
  fakeGit.changed = ['uv.lock']
  core.activateSpotlightCore.mockReset()
  core.syncSpotlightCore.mockReset()
  root = mkdtempSync(nodePath.join(tmpdir(), 'orca-spotlight-uv-service-'))
  state = activeState()
  await startSpotlightLogCapture({ repoId: REPO_ID, ptyId: PTY_ID, rootPath: root })
})

afterEach(async () => {
  stopSpotlightLogCapture({ repoId: REPO_ID })
  forgetSpotlightServerCommand(REPO_ID)
  clearSpotlightInstallPending(REPO_ID)
  // Let fire-and-forget log notes land before the temp root goes away.
  await new Promise((resolve) => setTimeout(resolve, 50))
  rmSync(root, { recursive: true, force: true, maxRetries: 3 })
})

describe('SpotlightService uv.lock check', () => {
  it('leaves the sync to the next start on a fresh activation', async () => {
    await runOrcaServer()
    state = null
    core.activateSpotlightCore.mockResolvedValue(activation(false))

    expect((await createService().activate(REPO_ID, HOLDER)).ok).toBe(true)
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(fakePty.writes).toEqual([])
    expect(isSpotlightInstallPending(REPO_ID)).toBe(true)
  })

  it('restarts the running server with uv sync first on a takeover', async () => {
    await runOrcaServer()
    core.activateSpotlightCore.mockResolvedValue(activation(true))

    expect((await createService().activate(REPO_ID, NEXT_HOLDER)).ok).toBe(true)

    await expectRestartedWith(`uv sync --frozen && ${COMMAND}`)
    expect(isSpotlightInstallPending(REPO_ID)).toBe(false)
  })

  it('restarts it the same way when a sync changes uv.lock', async () => {
    await runOrcaServer()
    core.syncSpotlightCore.mockResolvedValue(mirroredSync())

    expect((await createService().sync(REPO_ID)).ok).toBe(true)

    await expectRestartedWith(`uv sync --frozen && ${COMMAND}`)
  })

  it('installs both, pnpm first, when a takeover changes both lockfiles', async () => {
    fakeGit.changed = ['pnpm-lock.yaml', 'uv.lock']
    await runOrcaServer()
    core.activateSpotlightCore.mockResolvedValue(activation(true))

    await createService().activate(REPO_ID, NEXT_HOLDER)

    await expectRestartedWith(`pnpm install --frozen-lockfile && uv sync --frozen && ${COMMAND}`)
  })

  it('only notes the change when the running server was started by hand', async () => {
    fakePty.hasChildProcesses.mockResolvedValue(true)
    core.syncSpotlightCore.mockResolvedValue(mirroredSync())

    await createService().sync(REPO_ID)

    await vi.waitFor(
      () =>
        expect(readFileSync(nodePath.join(root, '.orca', 'spotlight.log'), 'utf-8')).toContain(
          'uv.lock changed — stop the server, run "uv sync", then start it again'
        ),
      { timeout: 1000, interval: 20 }
    )
    expect(fakePty.writes).toEqual([])
    expect(isSpotlightInstallPending(REPO_ID)).toBe(true)
  })

  it('leaves the server alone when no lockfile changed', async () => {
    fakeGit.changed = []
    await runOrcaServer()
    core.syncSpotlightCore.mockResolvedValue(mirroredSync())

    await createService().sync(REPO_ID)
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(fakePty.writes).toEqual([])
    expect(isSpotlightInstallPending(REPO_ID)).toBe(false)
  })
})
