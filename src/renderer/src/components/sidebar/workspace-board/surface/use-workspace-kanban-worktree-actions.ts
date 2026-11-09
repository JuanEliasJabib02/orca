import { useCallback } from 'react'
import { useAppStore } from '@/store'
import '../../workspace-status/presentation/workspace-status'
import { getWorkspaceStatus } from '../../../../../../shared/workspace-statuses'
import { switchSortToManualAfterDrop } from '../../worktree-list/listing/manual-sort-switch-toast'
import {
  resolveFullLaneDropIndex,
  toWorktreeDropIndex
} from '../drag/workspace-kanban-filtered-drop-index'
import {
  expandWorkspaceKanbanTaskMoveIds,
  flattenLaneItemWorktrees,
  getLaneItemWorktrees,
  type WorkspaceKanbanLaneItem
} from '../../workspace-kanban-lane-items'
import {
  buildManualOrderUpdatesForGroupDrop,
  shouldWriteManualOrderForGroupDrop,
  type WorktreeDragGroup
} from '../../worktree-list/drag/worktree-manual-order'
import type { WorktreeMeta } from '../../../../../../shared/worktree/meta-types'
import type {
  WorkspaceStatus,
  WorkspaceStatusDefinition,
  Worktree
} from '../../../../../../shared/worktree/types'
import type { WorktreeMetaBatchUpdate } from '../../../../store/slices/worktrees/metadata/worktree-meta-update-options'
import type { WorktreeManualOrderCatalog } from '../../worktree-list/drag/worktree-manual-order-catalog'
import { isWorkspaceStatusAllowedOnHost } from '@/store/workspaces/status/host-workspace-status-columns'
import { getWorktreeHostIdentity } from '../../../../../../shared/worktree/host-qualified-identity'

type LaneView = { items: readonly WorkspaceKanbanLaneItem[] }

export function useWorkspaceKanbanWorktreeActions(args: {
  boardDragGroups: readonly WorktreeDragGroup[]
  laneFullWorktreeIds: ReadonlyMap<string, readonly string[]>
  laneViews: ReadonlyMap<string, LaneView>
  /** Host identities of the cards whose status changed. */
  maybeSyncTaskStatuses: (worktreeKeys: readonly string[], status: WorkspaceStatus) => void
  sortBy: ReturnType<typeof useAppStore.getState>['sortBy']
  /** Task card member id → every id its move carries; see buildWorkspaceKanbanTaskMoveIndex. */
  taskMoveIdsByWorktreeId: ReadonlyMap<string, readonly string[]>
  /** The same by host identity, task card keys included; see buildWorkspaceKanbanTaskMoveKeyIndex. */
  taskMoveKeysByWorktreeKey: ReadonlyMap<string, readonly string[]>
  updateWorktreeMeta: ReturnType<typeof useAppStore.getState>['updateWorktreeMeta']
  updateWorktreesMeta: ReturnType<typeof useAppStore.getState>['updateWorktreesMeta']
  workspaceStatuses: readonly WorkspaceStatusDefinition[]
  worktreeById: ReadonlyMap<string, Worktree>
  /** Every card by host identity; lanes, drops and manual ranks use these keys. */
  worktreeByKey: ReadonlyMap<string, Worktree>
  manualOrderCatalog: WorktreeManualOrderCatalog
}) {
  const recordInteraction = (): void => {
    useAppStore.getState().recordFeatureInteraction('workspace-board-actions')
  }
  // Why only board-origin moves expand: a sidebar drop moves the one worktree it carries.
  const expandTaskMoves = useCallback(
    (worktreeIds: readonly string[]) =>
      expandWorkspaceKanbanTaskMoveIds(worktreeIds, args.taskMoveIdsByWorktreeId),
    [args.taskMoveIdsByWorktreeId]
  )
  // Pointer drops carry host identities, and a lone task card's key is its card id.
  const expandTaskMoveKeys = useCallback(
    (worktreeKeys: readonly string[]) =>
      expandWorkspaceKanbanTaskMoveIds(worktreeKeys, args.taskMoveKeysByWorktreeKey),
    [args.taskMoveKeysByWorktreeKey]
  )
  const getSourceStatusKeys = useCallback(
    (worktreeKeys: readonly string[]): WorkspaceStatus[] =>
      worktreeKeys.flatMap((key) => {
        const worktree = args.worktreeByKey.get(key)
        return worktree ? [getWorkspaceStatus(worktree, args.workspaceStatuses)] : []
      }),
    [args.workspaceStatuses, args.worktreeByKey]
  )
  const shouldWriteDropManualOrder = useCallback(
    (worktreeKeys: readonly string[], status: WorkspaceStatus): boolean =>
      shouldWriteManualOrderForGroupDrop({
        sortBy: args.sortBy,
        sourceGroupKeys: getSourceStatusKeys(expandTaskMoveKeys(worktreeKeys)),
        targetGroupKey: status
      }),
    [args.sortBy, expandTaskMoveKeys, getSourceStatusKeys]
  )
  const moveWorktreeToStatus = useCallback(
    (worktreeId: string, status: WorkspaceStatus) => {
      const current = args.worktreeById.get(worktreeId)
      if (!current || getWorkspaceStatus(current, args.workspaceStatuses) === status) {
        return
      }
      recordInteraction()
      void args.updateWorktreeMeta(
        worktreeId,
        { workspaceStatus: status },
        { executionHostId: current.hostId ?? 'local' }
      )
      args.maybeSyncTaskStatuses([getWorktreeHostIdentity(current)], status)
    },
    [args]
  )
  const moveWorktreesToStatus = useCallback(
    (worktreeIds: readonly string[], status: WorkspaceStatus) => {
      const updates: WorktreeMetaBatchUpdate[] = []
      const changedKeys: string[] = []
      for (const worktreeId of expandTaskMoves(worktreeIds)) {
        const current = args.worktreeById.get(worktreeId)
        if (!current || getWorkspaceStatus(current, args.workspaceStatuses) === status) {
          continue
        }
        changedKeys.push(getWorktreeHostIdentity(current))
        updates.push({
          worktreeId,
          updates: { workspaceStatus: status },
          executionHostId: current.hostId ?? 'local'
        })
      }
      if (changedKeys.length === 0) {
        return
      }
      recordInteraction()
      void args.updateWorktreesMeta(updates)
      args.maybeSyncTaskStatuses(changedKeys, status)
    },
    [args, expandTaskMoves]
  )
  const dropWorktreesInStatus = useCallback(
    (drop: {
      worktreeKeys: readonly string[]
      status: WorkspaceStatus
      dropIndex: number
      writeManualOrder?: boolean
    }) => {
      // Cards that can't take this status (another paired host's column) aren't re-ranked either.
      const state = useAppStore.getState()
      const rows = drop.worktreeKeys.flatMap((key) => {
        const current = args.worktreeByKey.get(key)
        return current && isWorkspaceStatusAllowedOnHost(state, current, drop.status)
          ? [current]
          : []
      })
      if (rows.length === 0) {
        return
      }
      const worktreeKeys = rows.map(getWorktreeHostIdentity)
      const writeManualOrder =
        drop.writeManualOrder ?? shouldWriteDropManualOrder(worktreeKeys, drop.status)
      const order = writeManualOrder
        ? buildManualOrderUpdatesForGroupDrop({
            groups: args.boardDragGroups,
            targetGroupKey: drop.status,
            draggedIds: worktreeKeys,
            dropIndex: drop.dropIndex,
            now: Date.now(),
            rankByWorktreeId: args.manualOrderCatalog.rankByKey,
            allWorktreeIds: args.manualOrderCatalog.orderedKeys
          })
        : { changed: false, updates: new Map<string, { manualOrder: number }>() }
      const updatesByKey = new Map<string, WorktreeMetaBatchUpdate>()
      for (const current of rows) {
        const next: Partial<WorktreeMeta> = {}
        if (getWorkspaceStatus(current, args.workspaceStatuses) !== drop.status) {
          next.workspaceStatus = drop.status
        }
        updatesByKey.set(getWorktreeHostIdentity(current), {
          worktreeId: current.id,
          updates: next,
          executionHostId: current.hostId ?? 'local'
        })
      }
      for (const [key, manualOrder] of order.updates) {
        const entry = updatesByKey.get(key)
        if (entry) {
          entry.updates = { ...entry.updates, ...manualOrder }
          continue
        }
        const current = args.worktreeByKey.get(key)
        if (current) {
          updatesByKey.set(key, {
            worktreeId: current.id,
            updates: manualOrder,
            executionHostId: current.hostId ?? 'local'
          })
        }
      }
      const changed = [...updatesByKey.values()].filter(
        (entry) => Object.keys(entry.updates).length > 0
      )
      if (changed.length === 0) {
        return
      }
      if (writeManualOrder && order.changed) {
        switchSortToManualAfterDrop()
      }
      recordInteraction()
      void args.updateWorktreesMeta(changed)
      args.maybeSyncTaskStatuses(worktreeKeys, drop.status)
    },
    [args, shouldWriteDropManualOrder]
  )
  const dropPointerDraggedWorktreesInStatus = useCallback(
    (drop: { worktreeKeys: readonly string[]; status: WorkspaceStatus; dropIndex: number }) => {
      const laneItems = args.laneViews.get(drop.status)?.items ?? []
      dropWorktreesInStatus({
        ...drop,
        worktreeKeys: expandTaskMoveKeys(drop.worktreeKeys),
        // Two steps: the pointer counts cards, a task card holds several worktrees, and only
        // then can the rendered (searched) lane map onto the full one.
        dropIndex: resolveFullLaneDropIndex({
          fullLaneIds: args.laneFullWorktreeIds.get(drop.status) ?? [],
          renderedIds: flattenLaneItemWorktrees(laneItems).map(getWorktreeHostIdentity),
          filteredDropIndex: toWorktreeDropIndex(
            laneItems.map((item) => getLaneItemWorktrees(item).length),
            drop.dropIndex
          )
        })
      })
    },
    [args.laneFullWorktreeIds, args.laneViews, dropWorktreesInStatus, expandTaskMoveKeys]
  )
  const dropWorktreesAtEndOfStatus = useCallback(
    (worktreeIds: readonly string[], status: WorkspaceStatus) => {
      // These drops carry bare ids, so only an id one host owns can name its card.
      const worktreeKeys = worktreeIds.flatMap((worktreeId) => {
        const current = args.worktreeById.get(worktreeId)
        return current ? [getWorktreeHostIdentity(current)] : []
      })
      dropWorktreesInStatus({
        worktreeKeys,
        status,
        dropIndex: args.laneFullWorktreeIds.get(status)?.length ?? 0,
        writeManualOrder: args.sortBy === 'manual'
      })
    },
    [args.laneFullWorktreeIds, args.sortBy, args.worktreeById, dropWorktreesInStatus]
  )
  const pinWorktree = useCallback(
    (worktreeId: string) => {
      const current = args.worktreeById.get(worktreeId)
      if (!current || current.isPinned) {
        return
      }
      void args.updateWorktreeMeta(
        worktreeId,
        { isPinned: true },
        { executionHostId: current.hostId ?? 'local' }
      )
    },
    [args]
  )
  const pinWorktrees = useCallback(
    (worktreeIds: readonly string[]) => {
      const updates: WorktreeMetaBatchUpdate[] = []
      for (const worktreeId of worktreeIds) {
        const current = args.worktreeById.get(worktreeId)
        if (current && !current.isPinned) {
          updates.push({
            worktreeId,
            updates: { isPinned: true },
            executionHostId: current.hostId ?? 'local'
          })
        }
      }
      if (updates.length > 0) {
        recordInteraction()
        void args.updateWorktreesMeta(updates)
      }
    },
    [args]
  )
  const pinPointerDraggedWorktrees = useCallback(
    (worktreeIds: readonly string[]) => pinWorktrees(expandTaskMoves(worktreeIds)),
    [expandTaskMoves, pinWorktrees]
  )
  return {
    dropPointerDraggedWorktreesInStatus,
    dropWorktreesAtEndOfStatus,
    moveWorktreeToStatus,
    moveWorktreesToStatus,
    pinPointerDraggedWorktrees,
    pinWorktree,
    pinWorktrees,
    shouldWriteDropManualOrder
  }
}
