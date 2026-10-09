import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Repo } from '../../shared/repo-types'
import type { SpotlightServerScriptDetection } from '../../shared/spotlight-server-types'
import type { WorktreeMeta } from '../../shared/worktree/meta-types'

const mocks = vi.hoisted(() => ({
  detect: vi.fn<(root: string) => Promise<SpotlightServerScriptDetection>>(async () => ({
    detected: {},
    scriptCommands: [],
    variants: ['do', 'pt']
  })),
  gitExec: vi.fn(
    async (
      args: string[],
      _options: { cwd: string; wslDistro?: string; env?: Record<string, string | undefined> }
    ) => ({
      stdout: args[0] === 'merge-base' ? 'a1b2c3d4e5f6a1b2c3d4\n' : 'apps/PT/page.tsx\0',
      stderr: ''
    })
  ),
  defaultBaseRef: vi.fn(async (_path: string, _options: unknown) => 'origin/main')
}))

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn(), removeHandler: vi.fn() } }))
vi.mock('../spotlight/spotlight-server-script-detection', () => ({
  detectSpotlightServerScripts: mocks.detect
}))
vi.mock('../git/runner', () => ({
  gitExecFileAsync: mocks.gitExec,
  gitOptionalLocksDisabledEnv: () => ({ GIT_OPTIONAL_LOCKS: '0' })
}))
vi.mock('../git/repo-default-base-ref', () => ({ getDefaultBaseRefAsync: mocks.defaultBaseRef }))
vi.mock('../project-runtime-git-options', () => ({ getLocalProjectWorktreeGitOptions: vi.fn() }))

import { inferSpotlightVariantForWorktree } from './spotlight-variant-handler'

const REPO: Repo = {
  id: 'landing',
  path: '/work/landing',
  displayName: 'landing',
  badgeColor: '#000',
  addedAt: 0,
  worktreeBaseRef: 'origin/develop'
}
const WORKTREE_ID = 'landing::/work/landing-ax'
const META = { baseRef: 'origin/release' }

function deps(
  repo: Repo | undefined,
  meta: Pick<WorktreeMeta, 'baseRef' | 'sparseBaseRef'> | undefined = META
): Parameters<typeof inferSpotlightVariantForWorktree>[0] {
  return {
    store: {
      getRepo: (id) => (repo && id === repo.id ? repo : undefined),
      getWorktreeMeta: () => meta
    },
    gitOptionsFor: () => ({ wslDistro: 'Ubuntu' })
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('inferSpotlightVariantForWorktree', () => {
  it('reads the holder checkout with its own base, without taking optional locks', async () => {
    const result = await inferSpotlightVariantForWorktree(deps(REPO), REPO.id, WORKTREE_ID)

    expect(result).toEqual({ kind: 'inferred', variant: 'pt' })
    expect(mocks.detect).toHaveBeenCalledWith('/work/landing')
    expect(mocks.gitExec.mock.calls[0]?.[0]).toEqual(['merge-base', 'origin/release', 'HEAD'])
    expect(mocks.gitExec.mock.calls[0]?.[1]).toMatchObject({
      cwd: '/work/landing-ax',
      wslDistro: 'Ubuntu',
      env: { GIT_OPTIONAL_LOCKS: '0' }
    })
    expect(mocks.defaultBaseRef).not.toHaveBeenCalled()
  })

  it('falls back to the repo base when the worktree has none', async () => {
    await inferSpotlightVariantForWorktree(deps(REPO, {}), REPO.id, WORKTREE_ID)

    expect(mocks.gitExec.mock.calls[0]?.[0]).toEqual(['merge-base', 'origin/develop', 'HEAD'])
  })

  it('reads no git for a repo without variants', async () => {
    mocks.detect.mockResolvedValueOnce({ detected: {}, scriptCommands: [] })

    expect(await inferSpotlightVariantForWorktree(deps(REPO), REPO.id, WORKTREE_ID)).toEqual({
      kind: 'ambiguous',
      candidates: []
    })
    expect(mocks.gitExec).not.toHaveBeenCalled()
  })

  it.each([
    ['a folder repo', { ...REPO, kind: 'folder' as const }, WORKTREE_ID],
    ['an SSH repo', { ...REPO, connectionId: 'ssh-1' }, WORKTREE_ID],
    ['a worktree of another repo', REPO, 'admin::/work/admin-ax'],
    ['an unknown repo', undefined, WORKTREE_ID]
  ])('answers ambiguous without reading anything for %s', async (_label, repo, worktreeId) => {
    expect(await inferSpotlightVariantForWorktree(deps(repo), REPO.id, worktreeId)).toEqual({
      kind: 'ambiguous',
      candidates: []
    })
    expect(mocks.detect).not.toHaveBeenCalled()
    expect(mocks.gitExec).not.toHaveBeenCalled()
  })

  it('answers ambiguous when the project runtime needs repair', async () => {
    const broken = deps(REPO)
    broken.gitOptionsFor = () => {
      throw new Error('Project runtime requires repair')
    }

    expect(await inferSpotlightVariantForWorktree(broken, REPO.id, WORKTREE_ID)).toEqual({
      kind: 'ambiguous',
      candidates: []
    })
    expect(mocks.gitExec).not.toHaveBeenCalled()
  })
})
