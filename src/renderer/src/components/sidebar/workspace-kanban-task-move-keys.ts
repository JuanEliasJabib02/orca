import type { WorkspaceStatus, Worktree } from '../../../../shared/worktree/types'
import { getWorktreeHostIdentity } from '../../../../shared/worktree/host-qualified-identity'
import type { WorkspaceKanbanLaneItem } from './workspace-kanban-lane-items'

/**
 * Host-identity form of buildWorkspaceKanbanTaskMoveIndex, for pointer drops, which carry card keys:
 * a task card's key and each board-visible member's identity → every identity its move carries.
 * Hidden members resolve through the unambiguous id index, like the id-based moves; a same-id twin is left out.
 */
export function buildWorkspaceKanbanTaskMoveKeyIndex(
  laneItems: ReadonlyMap<WorkspaceStatus, readonly WorkspaceKanbanLaneItem[]>,
  worktreeById: ReadonlyMap<string, Worktree>
): Map<string, readonly string[]> {
  const moveKeysByKey = new Map<string, readonly string[]>()
  for (const items of laneItems.values()) {
    for (const item of items) {
      if (item.type !== 'task') {
        continue
      }
      const visibleKeys = item.worktrees.map(getWorktreeHostIdentity)
      const moveKeys = new Set(visibleKeys)
      for (const memberId of item.memberIds) {
        const member = worktreeById.get(memberId)
        if (member) {
          moveKeys.add(getWorktreeHostIdentity(member))
        }
      }
      const keys = [...moveKeys]
      moveKeysByKey.set(item.key, keys)
      for (const key of visibleKeys) {
        moveKeysByKey.set(key, keys)
      }
    }
  }
  return moveKeysByKey
}
