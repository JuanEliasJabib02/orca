import type { Worktree } from '../../../../../../shared/worktree/types'
import { isServersLaneRow } from '../../../../../../shared/sidebar-list/server-root-lane'
import { resolveGroupByShowingRepo } from '../controls/project-filter-reveal'

// The lane rules live in src/shared so the shared row builder files roots under Servers too.
export * from '../../../../../../shared/sidebar-list/server-root-lane'

/** `isServersLaneRow` under the Group by of the space the reveal lands in, which may not be the active one. */
export function isServersRowOnReveal(
  state: Parameters<typeof resolveGroupByShowingRepo>[0],
  worktree: Pick<Worktree, 'repoId' | 'isMainWorktree' | 'isArchived' | 'ephemeralVmCheckoutMode'>
): boolean {
  return isServersLaneRow(worktree, state.repos, resolveGroupByShowingRepo(state, worktree.repoId))
}
