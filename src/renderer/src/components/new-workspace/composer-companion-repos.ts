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
