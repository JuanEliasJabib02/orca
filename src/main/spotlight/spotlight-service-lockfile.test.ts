import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import nodePath from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
    onData: vi.fn(() => () => {})
  }
})

// Git as the lockfile check sees it: whether pnpm-lock.yaml differs, and every call made.
const fakeGit = vi.hoisted(() => ({
  calls: [] as string[][],
  lockfileChanged: true
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
        return { stdout: fakeGit.lockfileChanged ? 'pnpm-lock.yaml\n' : '', stderr: '' }
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

import {
  clearSpotlightInstallPending,
  isSpotlightInstallPending
} from './spotlight-lockfile-install'
import { startSpotlightLogCapture, stopSpotlightLogCapture } from './spotlight-log-mirror'
import { forgetSpotlightServerCommand } from './spotlight-server-commands'
import { startSpotlightServer } from './spotlight-server-control'
import { SpotlightService } from './spotlight-service'

const REPO_ID = 'repo-1'
const PTY_ID = 'pty-1'
const INTERRUPT = String.fromCharCode(3)
const INSTALL = 'pnpm install --frozen-lockfile && '
const BACKUP_SHA = 'a'.repeat(40)
const PREVIOUS_SNAPSHOT_SHA = 'b'.repeat(40)
const NEW_SNAPSHOT_SHA = 'd'.repeat(40)
const HOLDER = `${REPO_ID}::/tmp/holder-one`
const NEXT_HOLDER = `${REPO_ID}::/tmp/holder-two`

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

function comparedShas(): string[][] {
  return fakeGit.calls.filter((args) => args[0] === 'diff-tree').map((args) => args.slice(2, 4))
}

/** A server Orca typed into the idle terminal earlier and that is running now. */
async function runOrcaServer(): Promise<void> {
  await startSpotlightServer({ repoId: REPO_ID, command: 'pnpm dev' })
  fakePty.writes.length = 0
  fakePty.hasChildProcesses.mockResolvedValue(true)
}

beforeEach(async () => {
  fakePty.writes.length = 0
  fakePty.hasChildProcesses.mockReset()
  fakePty.hasChildProcesses.mockResolvedValue(false)
  fakeGit.calls.length = 0
  fakeGit.lockfileChanged = true
  core.activateSpotlightCore.mockReset()
  core.syncSpotlightCore.mockReset()
  root = mkdtempSync(nodePath.join(tmpdir(), 'orca-spotlight-lockfile-service-'))
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

describe('SpotlightService lockfile check', () => {
  it('compares the root backup on a fresh activation and leaves the install to the next start', async () => {
    await runOrcaServer()
    state = null
    core.activateSpotlightCore.mockResolvedValue(activation(false))

    expect((await createService().activate(REPO_ID, HOLDER)).ok).toBe(true)
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(comparedShas()).toEqual([[BACKUP_SHA, NEW_SNAPSHOT_SHA]])
    expect(fakePty.writes).toEqual([])
    expect(isSpotlightInstallPending(REPO_ID)).toBe(true)
  })

  it('compares the previous snapshot on a takeover and restarts the running server', async () => {
    await runOrcaServer()
    core.activateSpotlightCore.mockResolvedValue(activation(true))

    expect((await createService().activate(REPO_ID, NEXT_HOLDER)).ok).toBe(true)

    expect(comparedShas()).toEqual([[PREVIOUS_SNAPSHOT_SHA, NEW_SNAPSHOT_SHA]])
    await vi.waitFor(
      () =>
        expect(fakePty.writes.map((entry) => entry.data)).toEqual([
          INTERRUPT,
          `${INSTALL}pnpm dev\r`
        ]),
      { timeout: 3000, interval: 50 }
    )
    expect(isSpotlightInstallPending(REPO_ID)).toBe(false)
  })

  it('restarts the running server with an install when a sync changes the lockfile', async () => {
    await runOrcaServer()
    core.syncSpotlightCore.mockResolvedValue({
      snapshotSha: NEW_SNAPSHOT_SHA,
      checkpointHeadSha: 'e'.repeat(40),
      skipped: false
    })

    expect((await createService().sync(REPO_ID)).ok).toBe(true)

    expect(comparedShas()).toEqual([[PREVIOUS_SNAPSHOT_SHA, NEW_SNAPSHOT_SHA]])
    await vi.waitFor(
      () =>
        expect(fakePty.writes.map((entry) => entry.data)).toEqual([
          INTERRUPT,
          `${INSTALL}pnpm dev\r`
        ]),
      { timeout: 3000, interval: 50 }
    )
  })

  it('only notes the change when the running server was started by hand', async () => {
    fakePty.hasChildProcesses.mockResolvedValue(true)
    core.syncSpotlightCore.mockResolvedValue({
      snapshotSha: NEW_SNAPSHOT_SHA,
      checkpointHeadSha: 'e'.repeat(40),
      skipped: false
    })

    await createService().sync(REPO_ID)

    await vi.waitFor(
      () =>
        expect(readFileSync(nodePath.join(root, '.orca', 'spotlight.log'), 'utf-8')).toContain(
          'pnpm-lock.yaml changed'
        ),
      { timeout: 1000, interval: 20 }
    )
    expect(fakePty.writes).toEqual([])
    expect(isSpotlightInstallPending(REPO_ID)).toBe(true)
  })

  it('leaves the server alone when the lockfile did not change', async () => {
    await runOrcaServer()
    fakeGit.lockfileChanged = false
    core.syncSpotlightCore.mockResolvedValue({
      snapshotSha: NEW_SNAPSHOT_SHA,
      checkpointHeadSha: 'e'.repeat(40),
      skipped: false
    })

    await createService().sync(REPO_ID)
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(fakePty.writes).toEqual([])
    expect(isSpotlightInstallPending(REPO_ID)).toBe(false)
  })

  it('reads no git when a sync mirrored nothing', async () => {
    core.syncSpotlightCore.mockResolvedValue({
      snapshotSha: PREVIOUS_SNAPSHOT_SHA,
      checkpointHeadSha: 'e'.repeat(40),
      skipped: true
    })
    state = { ...activeState(), lastError: { code: 'git-failed', message: 'earlier failure' } }

    expect((await createService().sync(REPO_ID)).ok).toBe(true)

    expect(fakeGit.calls).toEqual([])
    expect(isSpotlightInstallPending(REPO_ID)).toBe(false)
  })
})
