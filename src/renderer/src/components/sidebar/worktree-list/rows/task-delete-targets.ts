import type { Worktree } from '../../../../../../shared/worktree/types'
import {
  toWorktreeDeleteIdentities,
  type WorktreeDeleteIdentity
} from '../../worktree-delete-request'
import type { TaskSectionInfo } from '../grouping/row-types'

/** Delete identities for a task's worktrees; main checkouts, ids gone from the store and folder workspaces stay out. */
export function resolveTaskDeleteTargets(
  task: Pick<TaskSectionInfo, 'worktrees'>,
  worktreesByRepo: Readonly<Record<string, readonly Worktree[] | undefined>>
): WorktreeDeleteIdentity[] {
  const targets: Worktree[] = []
  for (const { worktreeId, repoId } of task.worktrees) {
    const worktree = worktreesByRepo[repoId]?.find((entry) => entry.id === worktreeId)
    if (worktree && !worktree.isMainWorktree) {
      targets.push(worktree)
    }
  }
  return toWorktreeDeleteIdentities(targets)
}
