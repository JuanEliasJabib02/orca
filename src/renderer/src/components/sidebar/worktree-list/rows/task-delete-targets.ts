import type { Worktree } from '../../../../../../shared/worktree/types'
import { isWorktreeInSidebarSpace, type SidebarSpaceScope } from '../../sidebar-space-scope'
import {
  toWorktreeDeleteIdentities,
  type WorktreeDeleteIdentity
} from '../../worktree-delete-request'
import { getTaskKeysForAllWorktrees } from '../grouping/worktree-task-keys'
import { deleteTargetKey } from './task-note-delete-cleanup'

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
        // Why: a provisioned VM root is in the task but is deleted through its own flow, not here.
        !worktree.isMainWorktree &&
        !worktree.isArchived &&
        (spaceScope === null || isWorktreeInSidebarSpace(worktree, spaceScope)) &&
        taskKeys.getTaskKey(worktree) === taskKey
    )
  )
}

/**
 * Whether a worktree of `taskKey` is left once `deleted` is gone, in any space: task keys, and the
 * task note keyed by them, are global, so another space's same-named task still owns them.
 */
export function hasTaskWorktreesBesides(
  taskKey: string | null,
  allWorktrees: readonly Worktree[],
  deleted: readonly WorktreeDeleteIdentity[]
): boolean {
  if (taskKey === null) {
    return false
  }
  const deletedKeys = new Set(deleted.map((target) => deleteTargetKey(target.id, target.hostId)))
  const taskKeys = getTaskKeysForAllWorktrees(allWorktrees)
  // Why not resolveTaskDeleteTargets: a provisioned VM root is not deleted with the task but keeps the note.
  return allWorktrees.some(
    (worktree) =>
      !worktree.isArchived &&
      (!worktree.isMainWorktree || worktree.ephemeralVmCheckoutMode === 'provisioned-root') &&
      taskKeys.getTaskKey(worktree) === taskKey &&
      !deletedKeys.has(deleteTargetKey(worktree.id, worktree.hostId))
  )
}
