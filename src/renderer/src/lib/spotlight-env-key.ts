import {
  getWorktreeTaskKey,
  type TaskKeyWorktree
} from '@/components/sidebar/worktree-list/grouping/worktree-task-keys'
import { isUsableTaskKey } from '@/store/slices/ui/ui-slice-task-key-record'

export type SpotlightEnvKeyWorktree = TaskKeyWorktree & { id: string }

/** The key a Spotlight environment is stored under: the task key, else the workspace's own id so a
 *  workspace with no task has one too. Null when it is too long to store (the env stays Local). */
export function toSpotlightEnvKey(taskKey: string | null, worktreeId: string): string | null {
  const key = taskKey ?? worktreeId
  return isUsableTaskKey(key) ? key : null
}

/** `allWorktrees` is every worktree of every repo, unfiltered, so branch-name tasks match the sidebar. */
export function getSpotlightEnvKey(
  worktree: SpotlightEnvKeyWorktree,
  allWorktrees: readonly TaskKeyWorktree[]
): string | null {
  return toSpotlightEnvKey(getWorktreeTaskKey(worktree, allWorktrees), worktree.id)
}
