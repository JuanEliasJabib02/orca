import { useCallback } from 'react'
import { useAppStore } from '@/store'
import { getWorkspaceStatus } from './workspace-status'
import {
  resolveFullLaneDropIndex,
  toWorktreeDropIndex
} from './workspace-kanban-filtered-drop-index'
import {
  expandWorkspaceKanbanTaskMoveIds,
  getLaneItemWorktreeIds,
  getLaneItemWorktrees,
  type WorkspaceKanbanLaneItem
} from './workspace-kanban-lane-items'
import {
  buildManualOrderUpdatesForGroupDrop,
  shouldWriteManualOrderForGroupDrop,
  type WorktreeDragGroup
} from './worktree-manual-order'
import type { WorktreeMeta } from '../../../../shared/worktree/meta-types'
import type { WorkspaceStatus, Worktree } from '../../../../shared/worktree/types'
import type { WorktreeMetaBatchUpdate } from '../../store/slices/worktree-helpers'
import type { WorktreeManualOrderCatalog } from './worktree-manual-order-catalog'

type LaneView = { items: readonly WorkspaceKanbanLaneItem[] }

export function useWorkspaceKanbanWorktreeActions(args: {
  boardDragGroups: readonly WorktreeDragGroup[]
  laneFullWorktreeIds: ReadonlyMap<string, readonly string[]>
  laneViews: ReadonlyMap<string, LaneView>
  maybeSyncTaskStatuses: (worktreeIds: readonly string[], status: WorkspaceStatus) => void
  setSortBy: ReturnType<typeof useAppStore.getState>['setSortBy']
  sortBy: ReturnType<typeof useAppStore.getState>['sortBy']
  /** Task card member id → every id its move carries; see buildWorkspaceKanbanTaskMoveIndex. */
  taskMoveIdsByWorktreeId: ReadonlyMap<string, readonly string[]>
  updateWorktreeMeta: ReturnType<typeof useAppStore.getState>['updateWorktreeMeta']
  updateWorktreesMeta: ReturnType<typeof useAppStore.getState>['updateWorktreesMeta']
  workspaceStatuses: ReturnType<typeof useAppStore.getState>['workspaceStatuses']
  worktreeById: ReadonlyMap<string, Worktree>
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
  const getSourceStatusKeys = useCallback(
    (worktreeIds: readonly string[]): WorkspaceStatus[] =>
      worktreeIds.flatMap((worktreeId) => {
        const worktree = args.worktreeById.get(worktreeId)
        return worktree ? [getWorkspaceStatus(worktree, args.workspaceStatuses)] : []
      }),
    [args.workspaceStatuses, args.worktreeById]
  )
  const shouldWriteDropManualOrder = useCallback(
    (worktreeIds: readonly string[], status: WorkspaceStatus): boolean =>
      shouldWriteManualOrderForGroupDrop({
        sortBy: args.sortBy,
        sourceGroupKeys: getSourceStatusKeys(expandTaskMoves(worktreeIds)),
        targetGroupKey: status
      }),
    [args.sortBy, expandTaskMoves, getSourceStatusKeys]
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
      args.maybeSyncTaskStatuses([worktreeId], status)
    },
    [args]
  )
  const moveWorktreesToStatus = useCallback(
    (worktreeIds: readonly string[], status: WorkspaceStatus) => {
      const updates: WorktreeMetaBatchUpdate[] = []
      const changedIds: string[] = []
      for (const worktreeId of expandTaskMoves(worktreeIds)) {
        const current = args.worktreeById.get(worktreeId)
        if (!current || getWorkspaceStatus(current, args.workspaceStatuses) === status) {
          continue
        }
        changedIds.push(worktreeId)
        updates.push({
          worktreeId,
          updates: { workspaceStatus: status },
          executionHostId: current.hostId ?? 'local'
        })
      }
      if (changedIds.length === 0) {
        return
      }
      recordInteraction()
      void args.updateWorktreesMeta(updates)
      args.maybeSyncTaskStatuses(changedIds, status)
    },
    [args, expandTaskMoves]
  )
  const dropWorktreesInStatus = useCallback(
    (drop: {
      worktreeIds: readonly string[]
      status: WorkspaceStatus
      dropIndex: number
      writeManualOrder?: boolean
    }) => {
      const updates: WorktreeMetaBatchUpdate[] = []
      const writeManualOrder =
        drop.writeManualOrder ?? shouldWriteDropManualOrder(drop.worktreeIds, drop.status)
      const order = writeManualOrder
        ? buildManualOrderUpdatesForGroupDrop({
            groups: args.boardDragGroups,
            targetGroupKey: drop.status,
            draggedIds: drop.worktreeIds,
            dropIndex: drop.dropIndex,
            now: Date.now(),
            rankByWorktreeId: args.manualOrderCatalog.rankByWorktreeId,
            allWorktreeIds: args.manualOrderCatalog.orderedIds
          })
        : { changed: false, updates: new Map<string, { manualOrder: number }>() }
      for (const worktreeId of drop.worktreeIds) {
        const current = args.worktreeById.get(worktreeId)
        if (!current) {
          continue
        }
        const next: Partial<WorktreeMeta> = {}
        if (getWorkspaceStatus(current, args.workspaceStatuses) !== drop.status) {
          next.workspaceStatus = drop.status
        }
        updates.push({
          worktreeId,
          updates: next,
          executionHostId: current.hostId ?? 'local'
        })
      }
      for (const [worktreeId, manualOrder] of order.updates) {
        const entry = updates.find((candidate) => candidate.worktreeId === worktreeId)
        if (entry) {
          entry.updates = { ...entry.updates, ...manualOrder }
          continue
        }
        const current = args.worktreeById.get(worktreeId)
        if (current) {
          updates.push({
            worktreeId,
            updates: manualOrder,
            executionHostId: current.hostId ?? 'local'
          })
        }
      }
      const changed = updates.filter((entry) => Object.keys(entry.updates).length > 0)
      if (changed.length === 0) {
        return
      }
      if (writeManualOrder && order.changed) {
        args.setSortBy('manual')
      }
      recordInteraction()
      void args.updateWorktreesMeta(changed)
      args.maybeSyncTaskStatuses(drop.worktreeIds, drop.status)
    },
    [args, shouldWriteDropManualOrder]
  )
  const dropPointerDraggedWorktreesInStatus = useCallback(
    (drop: { worktreeIds: readonly string[]; status: WorkspaceStatus; dropIndex: number }) => {
      const laneItems = args.laneViews.get(drop.status)?.items ?? []
      dropWorktreesInStatus({
        ...drop,
        worktreeIds: expandTaskMoves(drop.worktreeIds),
        // Why two steps: the pointer counts cards, a task card holds several worktrees, and
        // only then can the rendered (searched) lane map onto the full one.
        dropIndex: resolveFullLaneDropIndex({
          fullLaneIds: args.laneFullWorktreeIds.get(drop.status) ?? [],
          renderedIds: getLaneItemWorktreeIds(laneItems),
          filteredDropIndex: toWorktreeDropIndex(
            laneItems.map((item) => getLaneItemWorktrees(item).length),
            drop.dropIndex
          )
        })
      })
    },
    [args.laneFullWorktreeIds, args.laneViews, dropWorktreesInStatus, expandTaskMoves]
  )
  const dropWorktreesAtEndOfStatus = useCallback(
    (worktreeIds: readonly string[], status: WorkspaceStatus) => {
      dropWorktreesInStatus({
        worktreeIds,
        status,
        dropIndex: args.laneFullWorktreeIds.get(status)?.length ?? 0,
        writeManualOrder: args.sortBy === 'manual'
      })
    },
    [args.laneFullWorktreeIds, args.sortBy, dropWorktreesInStatus]
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
