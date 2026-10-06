import type { Repo } from '../../../../../../shared/repo-types'
import type { SpotlightOpResult, SpotlightRepoState } from '../../../../../../shared/spotlight'
import type { Worktree } from '../../../../../../shared/worktree/types'
import {
  repo as baseRepo,
  worktree as baseWorktree
} from '../../worktree-list-groups-test-fixtures'

/** A local git repo with Spotlight testing on, so it can hold a task worktree. */
export function makeSpotlightRepo(id: string, overrides: Partial<Repo> = {}): Repo {
  return {
    ...baseRepo,
    id,
    displayName: id,
    path: `/tmp/${id}`,
    spotlightTestingEnabled: true,
    ...overrides
  }
}

export function makeTaskWorktree(
  id: string,
  repoId: string,
  overrides: Partial<Worktree> = {}
): Worktree {
  return { ...baseWorktree, id, repoId, displayName: id, ...overrides }
}

export const OP_OK: SpotlightOpResult = { ok: true, state: null }

export const OP_FAILED: SpotlightOpResult = {
  ok: false,
  error: { code: 'git-failed', message: 'git failed' },
  state: null
}

/** Spotlight state for each repo, keyed by the worktree that holds it. */
export function holdersByRepo(holders: Record<string, string>): Record<string, SpotlightRepoState> {
  return Object.fromEntries(
    Object.entries(holders).map(([repoId, holderWorktreeId]) => [
      repoId,
      {
        repoId,
        holderWorktreeId,
        status: 'active',
        originalBranch: 'main',
        originalHeadSha: 'sha-head',
        backupSha: 'sha-head',
        lastSnapshotSha: null,
        activatedAt: 0,
        lastSyncAt: null,
        lastError: null
      } satisfies SpotlightRepoState
    ])
  )
}
