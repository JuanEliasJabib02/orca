import type { Repo } from '../../../../shared/repo-types'
import { getRepoExecutionHostId } from '../../../../shared/execution-host'
import { isGitRepoKind } from '../../../../shared/repo-kind'
import type { SidebarSpaceScope } from '@/components/sidebar/sidebar-space-scope'

/**
 * Repos the primary's worktree can be mirrored into: git repos other than the primary, on the
 * primary's host (the agent can only reach paths there), narrowed to the active space.
 */
export function listComposerCompanionCandidates(args: {
  repos: readonly Repo[]
  primaryRepo: Repo | null | undefined
  scope: Pick<SidebarSpaceScope, 'repoIds'> | null
}): Repo[] {
  const { repos, primaryRepo, scope } = args
  if (!primaryRepo || !isGitRepoKind(primaryRepo)) {
    return []
  }
  const primaryHostId = getRepoExecutionHostId(primaryRepo)
  return repos.filter(
    (repo) =>
      repo.id !== primaryRepo.id &&
      isGitRepoKind(repo) &&
      getRepoExecutionHostId(repo) === primaryHostId &&
      (!scope || scope.repoIds.has(repo.id))
  )
}

/** Remembered companions that are still offered, in the order the row shows them. */
export function selectRememberedCompanionIds(
  remembered: readonly string[] | undefined,
  candidates: readonly Pick<Repo, 'id'>[]
): string[] {
  const rememberedIds = new Set(remembered ?? [])
  return candidates.filter((repo) => rememberedIds.has(repo.id)).map((repo) => repo.id)
}

/**
 * The list to remember after a toggle: the visible selection, plus remembered ids the current
 * space merely hides. Ids whose repo is gone are dropped.
 */
export function mergeRememberedCompanionIds(args: {
  remembered: readonly string[] | undefined
  candidateIds: ReadonlySet<string>
  existingRepoIds: ReadonlySet<string>
  selectedIds: readonly string[]
}): string[] {
  const hidden = (args.remembered ?? []).filter(
    (repoId) => !args.candidateIds.has(repoId) && args.existingRepoIds.has(repoId)
  )
  return [...new Set([...args.selectedIds, ...hidden])]
}
