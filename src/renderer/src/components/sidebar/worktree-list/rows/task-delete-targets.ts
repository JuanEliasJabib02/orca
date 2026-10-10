import type { Worktree } from '../../../../../../shared/worktree/types'
import { isWorktreeInSidebarSpace, type SidebarSpaceScope } from '../../sidebar-space-scope'
import {
  toWorktreeDeleteIdentities,
  type WorktreeDeleteIdentity
} from '../../worktree-delete-request'
import { getTaskKeysForAllWorktrees } from '../grouping/worktree-task-keys'

/**
 * Delete identities for every worktree filed under `taskKey` in the active space, hidden by sidebar
 * filters or not; `allWorktrees` is the unfiltered set and a null `spaceScope` means every space.
 * Main checkouts and archived worktrees stay out, and folder workspaces are not worktrees.
 */
export function resolveTaskDeleteTargets(
  taskKey: string | null,
  allWorktrees: readonly Worktree[],
  // Why required: task keys are global, so a name like "sidebar" can match a worktree of another space.
  spaceScope: SidebarSpaceScope | null
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
        (spaceScope === null || isWorktreeInSidebarSpace(worktree, spaceScope)) &&
        taskKeys.getTaskKey(worktree) === taskKey
    )
  )
}
