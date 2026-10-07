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

vi.mock('../ipc/pty', () => ({
  getLocalPtyProvider: () => fakePty,
  onLocalPtyProviderChanged: () => () => {}
}))
vi.mock('../git/runner', () => ({
  gitExecFileAsync: vi.fn(async () => ({ stdout: '.git/info/exclude', stderr: '' }))
}))
vi.mock('../git/spotlight-sync', () => ({
  createLocalSpotlightGitContext: () => ({})
}))
vi.mock('./spotlight-state-file', () => ({
  writeSpotlightStateFile: vi.fn(async () => {})
}))
vi.mock('../../shared/spotlight-sync-core', async (importOriginal) => ({
  ...(await importOriginal<typeof SpotlightSyncCore>()),
  deactivateSpotlightCore: vi.fn(async () => ({
    branchMissing: false,
    originalBranch: 'main',
    branchInUse: false
  }))
}))

import { deactivateSpotlightCore } from '../../shared/spotlight-sync-core'
import {
  isSpotlightInstallPending,
  markSpotlightInstallPending
} from './spotlight-lockfile-install'
import {
  getSpotlightTerminal,
  startSpotlightLogCapture,
  stopSpotlightLogCapture
} from './spotlight-log-mirror'
import {
  forgetSpotlightServerCommand,
  getSpotlightServerCommand
} from './spotlight-server-commands'
import { startSpotlightServer } from './spotlight-server-control'
import { SpotlightService } from './spotlight-service'

const REPO_ID = 'repo-1'
const PTY_ID = 'pty-1'
const INTERRUPT = String.fromCharCode(3)

let root = ''
let state: SpotlightRepoState | null = null

function createService(): SpotlightService {
  const store = {
    getRepo: (repoId: string) => (repoId === REPO_ID ? { id: REPO_ID, path: root } : undefined),
    getSpotlightState: () => state,
    getAllSpotlightStates: () => (state ? { [REPO_ID]: state } : {}),
    setSpotlightState: (_repoId: string, next: SpotlightRepoState) => {
      state = next
    },
    clearSpotlightState: () => {
      state = null
    }
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: deactivate only reads the repo and the Spotlight record, both faked above.
  return new SpotlightService(store as unknown as Store, () => null)
}

beforeEach(async () => {
  fakePty.writes.length = 0
  fakePty.hasChildProcesses.mockReset()
  fakePty.hasChildProcesses.mockResolvedValue(false)
  fakePty.getForegroundProcess.mockReset()
  fakePty.getForegroundProcess.mockResolvedValue('zsh')
  root = mkdtempSync(nodePath.join(tmpdir(), 'orca-spotlight-deactivate-'))
  state = {
    repoId: REPO_ID,
    holderWorktreeId: `${REPO_ID}::/tmp/holder`,
    status: 'active',
    originalBranch: 'main',
    originalHeadSha: 'a'.repeat(40),
    backupSha: 'a'.repeat(40),
    lastSnapshotSha: 'b'.repeat(40),
    activatedAt: 1,
    lastSyncAt: null,
    lastError: null
  }
  await startSpotlightLogCapture({ repoId: REPO_ID, ptyId: PTY_ID, rootPath: root })
})

afterEach(async () => {
  stopSpotlightLogCapture({ repoId: REPO_ID })
  forgetSpotlightServerCommand(REPO_ID)
  // Let fire-and-forget log notes land before the temp root goes away.
  await new Promise((resolve) => setTimeout(resolve, 50))
  rmSync(root, { recursive: true, force: true, maxRetries: 3 })
})

describe('SpotlightService.deactivate', () => {
  it('interrupts a running server before restoring the root', async () => {
    fakePty.hasChildProcesses.mockResolvedValue(true)
    await startSpotlightServer({ repoId: REPO_ID, command: 'pnpm dev' })
    let writesWhenRestoring: string[] = []
    vi.mocked(deactivateSpotlightCore).mockImplementationOnce(async () => {
      writesWhenRestoring = fakePty.writes.map((entry) => entry.data)
      return { branchMissing: false, originalBranch: 'main', branchInUse: false }
    })

    const result = await createService().deactivate(REPO_ID)

    expect(result).toEqual({ ok: true, state: null })
    expect(writesWhenRestoring).toEqual([INTERRUPT])
    expect(fakePty.writes).toEqual([{ id: PTY_ID, data: INTERRUPT }])
    expect(getSpotlightTerminal(REPO_ID)).toBeNull()
    expect(getSpotlightServerCommand(REPO_ID)).toBeUndefined()
  })

  it('keeps Spotlight on with its server stopped when the restore fails, and says so', async () => {
    fakePty.hasChildProcesses.mockResolvedValue(true)
    await startSpotlightServer({ repoId: REPO_ID, command: 'pnpm dev' })
    vi.mocked(deactivateSpotlightCore).mockRejectedValueOnce(new Error('merge in progress'))

    const result = await createService().deactivate(REPO_ID)

    expect(result).toMatchObject({ ok: false, error: { code: 'git-failed' } })
    expect(state).not.toBeNull()
    expect(fakePty.writes).toEqual([{ id: PTY_ID, data: INTERRUPT }])
    // Server control gets the terminal back, so Orca can start the server again.
    expect(getSpotlightTerminal(REPO_ID)).toMatchObject({ ptyId: PTY_ID })
    expect(getSpotlightServerCommand(REPO_ID)).toBe('pnpm dev')
    await vi.waitFor(
      () =>
        expect(readFileSync(nodePath.join(root, '.orca', 'spotlight.log'), 'utf-8')).toContain(
          'Spotlight off failed'
        ),
      { timeout: 1000, interval: 20 }
    )
  })

  it('leaves an idle Spotlight terminal alone', async () => {
    const result = await createService().deactivate(REPO_ID)

    expect(result).toEqual({ ok: true, state: null })
    expect(fakePty.hasChildProcesses).toHaveBeenCalledWith(PTY_ID)
    expect(fakePty.writes).toEqual([])
    expect(getSpotlightTerminal(REPO_ID)).toBeNull()
  })

  it('forgets an install a lockfile change left pending', async () => {
    markSpotlightInstallPending(REPO_ID)

    await createService().deactivate(REPO_ID)

    expect(isSpotlightInstallPending(REPO_ID)).toBe(false)
  })
})
