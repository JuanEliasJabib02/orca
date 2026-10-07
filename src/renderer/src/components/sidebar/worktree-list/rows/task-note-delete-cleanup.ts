import type { WorktreeRemovalTarget } from '../../../../../../shared/worktree/removal'
import type { WorktreeDeleteIdentity } from '../../worktree-delete-request'

// Why host + id: the same `repoId::path` id can exist on two hosts (STA-4343).
function targetKey(id: string, hostId: string | null | undefined): string {
  return `${hostId ?? ''}|${id}`
}

/**
 * Builds the `onDeleted` callback for a task delete: runs `onAllDeleted` once every target has been
 * reported deleted. Reports arrive in several batches (force-deletes one by one, then the batch).
 */
export function createTaskDeleteCompletion(
  targets: readonly WorktreeDeleteIdentity[],
  onAllDeleted: () => void
): (deleted: readonly WorktreeRemovalTarget[]) => void {
  const remaining = new Set(targets.map((target) => targetKey(target.id, target.hostId)))
  return (deleted) => {
    if (remaining.size === 0) {
      return
    }
    for (const target of deleted) {
      remaining.delete(targetKey(target.id, target.executionHostId))
    }
    if (remaining.size === 0) {
      onAllDeleted()
    }
  }
}
