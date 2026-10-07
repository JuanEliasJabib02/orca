import type { Worktree } from '../../../../../../shared/worktree/types'
import {
  toWorktreeDeleteIdentities,
  type WorktreeDeleteIdentity
} from '../../worktree-delete-request'
import { getTaskKeysForAllWorktrees } from '../grouping/worktree-task-keys'

/**
 * Delete identities for every worktree filed under `taskKey`, hidden by sidebar filters or not;
 * `allWorktrees` is the unfiltered set. Main checkouts and archived worktrees stay out, and folder
 * workspaces are not worktrees.
 */
export function resolveTaskDeleteTargets(
  taskKey: string | null,
  allWorktrees: readonly Worktree[]
): WorktreeDeleteIdentity[] {
  if (taskKey === null) {
    return []
  }
  const taskKeys = getTaskKeysForAllWorktrees(allWorktrees)
  return toWorktreeDeleteIdentities(
    allWorktrees.filter(
      (worktree) =>
        !worktree.isMainWorktree &&
        !worktree.isArchived &&
        taskKeys.getTaskKey(worktree) === taskKey
    )
  )
}
