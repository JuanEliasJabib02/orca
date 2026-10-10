import type { Repo } from '../../../../../../shared/repo-types'
import { isFolderRepo } from '../../../../../../shared/repo-kind'
import type { Worktree } from '../../../../../../shared/worktree/types'
import type { WorktreeGroupBy } from './row-types'
import type { WorktreeTaskKeys } from './worktree-task-keys'
import { resolveGroupByShowingRepo } from '../../project-filter-reveal'

/** Group by → Task's trailing section of project roots. Outside `task:` so no task name can claim it. */
export const SERVERS_LANE_KEY = 'servers'

/**
 * A git project's main checkout, where its Spotlight server runs; folder projects have none.
 * Provisioned roots are the recipe-created workspace itself (same carve-out as isDefaultBranchWorkspace).
 */
export function isServerRootWorktree(
  worktree: Pick<Worktree, 'isMainWorktree' | 'isArchived' | 'ephemeralVmCheckoutMode'>,
  repo: Pick<Repo, 'kind'> | undefined
): boolean {
  return (
    worktree.isMainWorktree &&
    !worktree.isArchived &&
    worktree.ephemeralVmCheckoutMode !== 'provisioned-root' &&
    repo !== undefined &&
    !isFolderRepo(repo)
  )
}

/** Whether the sidebar lists `worktree` under Servers, where no workspace filter can hide it. */
export function isServersLaneRow(
  worktree: Pick<Worktree, 'repoId' | 'isMainWorktree' | 'isArchived' | 'ephemeralVmCheckoutMode'>,
  repos: readonly Pick<Repo, 'id' | 'kind'>[],
  groupBy: WorktreeGroupBy
): boolean {
  return (
    groupBy === 'task' &&
    isServerRootWorktree(
      worktree,
      repos.find((repo) => repo.id === worktree.repoId)
    )
  )
}

/** `isServersLaneRow` under the Group by of the space the reveal lands in, which may not be the active one. */
export function isServersRowOnReveal(
  state: Parameters<typeof resolveGroupByShowingRepo>[0],
  worktree: Parameters<typeof isServersLaneRow>[0]
): boolean {
  return isServersLaneRow(worktree, state.repos, resolveGroupByShowingRepo(state, worktree.repoId))
}

/** The Group by → Task section a worktree renders in: Servers for project roots, else its task's. */
export function getTaskModeLaneKey(
  worktree: Worktree,
  repoMap: ReadonlyMap<string, Repo>,
  taskKeys: WorktreeTaskKeys
): string {
  return isServerRootWorktree(worktree, repoMap.get(worktree.repoId))
    ? SERVERS_LANE_KEY
    : taskKeys.getLaneKey(worktree)
}
