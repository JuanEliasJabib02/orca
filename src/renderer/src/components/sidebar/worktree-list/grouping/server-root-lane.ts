import type { Repo } from '../../../../../../shared/repo-types'
import { isFolderRepo } from '../../../../../../shared/repo-kind'
import type { Worktree } from '../../../../../../shared/worktree/types'
import type { WorktreeTaskKeys } from './worktree-task-keys'

/** Group by → Task's trailing section of project roots. Outside `task:` so no task name can claim it. */
export const SERVERS_LANE_KEY = 'servers'

/** A git project's main checkout, where its Spotlight server runs; folder projects have none. */
export function isServerRootWorktree(
  worktree: Pick<Worktree, 'isMainWorktree' | 'isArchived'>,
  repo: Pick<Repo, 'kind'> | undefined
): boolean {
  return (
    worktree.isMainWorktree && !worktree.isArchived && repo !== undefined && !isFolderRepo(repo)
  )
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
