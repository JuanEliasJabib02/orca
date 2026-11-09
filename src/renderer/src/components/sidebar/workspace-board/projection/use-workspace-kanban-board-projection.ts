import { useLayoutEffect, useMemo } from 'react'
import { useAppStore } from '@/store'
import { useVisibleWorkspaceKanbanWorktreeIds } from '../surface/use-visible-workspace-kanban-worktree-ids'
import { groupWorkspaceKanbanWorktrees } from './workspace-kanban-worktree-groups'
import { buildWorkspaceKanbanLaneViews } from '../search/workspace-kanban-search'
import { useWorkspaceKanbanSearch } from '../search/use-workspace-kanban-search'
import { registerWorkspaceKanbanSidebarDropGroups } from '../drag/workspace-kanban-sidebar-drop'
import { buildUnambiguousWorktreeIdIndex } from '../../worktree-list/navigation/worktree-unambiguous-id-index'
import { useActiveSidebarSpaceScope } from '../../use-active-sidebar-space'
import { getSidebarTaskKeys } from '../../../../../../shared/sidebar-list/worktree-task-keys'
import {
  buildWorkspaceKanbanLaneItems,
  buildWorkspaceKanbanTaskMoveIndex,
  collectWorkspaceKanbanTaskMoveIds,
  flattenLaneItemWorktrees,
  type WorkspaceKanbanTaskGrouping
} from '../../workspace-kanban-lane-items'
import { buildWorkspaceKanbanTaskMoveKeyIndex } from '../../workspace-kanban-task-move-keys'
import { buildWorkspaceKanbanCardMembers } from '../../workspace-kanban-card-selection'
import { sectionWorkspaceKanbanLaneItemsByProject } from '../../workspace-kanban-project-sections'
import { useWorkspaceKanbanProjectSections } from '../../use-workspace-kanban-project-sections'
import {
  composeWorktreeHostIdentity,
  getWorktreeHostIdentity
} from '../../../../../../shared/worktree/host-qualified-identity'
import type { WorkspaceStatusDefinition, Worktree } from '../../../../../../shared/worktree/types'
import type { ExecutionHostId } from '../../../../../../shared/execution-host'
import type { WorktreeDragGroup } from '../../worktree-list/drag/worktree-manual-order'
import type { useRepoMap } from '@/store/repos/use-repository-catalog'

export function useWorkspaceKanbanBoardProjection(args: {
  activeWorktreeId: string | null
  activeWorkspaceExecutionHostId: ExecutionHostId | null
  allWorktrees: readonly Worktree[]
  open: boolean
  repoMap: ReturnType<typeof useRepoMap>
  sortBy: ReturnType<typeof useAppStore.getState>['sortBy']
  workspaceStatuses: readonly WorkspaceStatusDefinition[]
}) {
  const groupBy = useAppStore((s) => s.groupBy)
  const spaceScope = useActiveSidebarSpaceScope()
  const projectSections = useWorkspaceKanbanProjectSections(groupBy === 'repo', args.repoMap)
  const visibleWorktreeIds = useVisibleWorkspaceKanbanWorktreeIds({
    allWorktrees: args.allWorktrees,
    repoMap: args.repoMap
  })
  const worktreesByStatus = useMemo(
    () =>
      groupWorkspaceKanbanWorktrees({
        worktrees: args.allWorktrees,
        visibleWorktreeIds,
        workspaceStatuses: args.workspaceStatuses,
        sortBy: args.sortBy
      }),
    [args.allWorktrees, args.sortBy, args.workspaceStatuses, visibleWorktreeIds]
  )
  // Why the sidebar's index over every worktree: the board must file a worktree under the same task.
  const taskGrouping = useMemo<WorkspaceKanbanTaskGrouping | null>(() => {
    if (groupBy !== 'task') {
      return null
    }
    const taskKeys = getSidebarTaskKeys(groupBy, args.allWorktrees)
    return {
      taskKeys,
      moveIdsByTaskKey: collectWorkspaceKanbanTaskMoveIds({
        allWorktrees: args.allWorktrees,
        taskKeys,
        spaceScope
      })
    }
  }, [args.allWorktrees, groupBy, spaceScope])
  const laneItems = useMemo(() => {
    const items = buildWorkspaceKanbanLaneItems({
      worktreesByStatus,
      workspaceStatuses: args.workspaceStatuses,
      taskGrouping
    })
    // Why: Group by → Project files each lane's cards under project sub-headers.
    return projectSections
      ? sectionWorkspaceKanbanLaneItemsByProject(items, projectSections)
      : items
  }, [args.workspaceStatuses, projectSections, taskGrouping, worktreesByStatus])
  const worktreeById = useMemo(
    () => buildUnambiguousWorktreeIdIndex(args.allWorktrees),
    [args.allWorktrees]
  )
  // Drops carry each card's host identity, so same-id copies on two hosts stay separate cards.
  const worktreeByKey = useMemo(
    () =>
      new Map(args.allWorktrees.map((worktree) => [getWorktreeHostIdentity(worktree), worktree])),
    [args.allWorktrees]
  )
  // Card order: manual order, sidebar-drop groups and range selection must match the screen.
  const boardWorktrees = useMemo(
    () =>
      args.workspaceStatuses.flatMap((status) =>
        flattenLaneItemWorktrees(laneItems.get(status.id) ?? [])
      ),
    [args.workspaceStatuses, laneItems]
  )
  // Lane members are host identities, as in the sidebar's drag groups.
  const boardDragGroups = useMemo<WorktreeDragGroup[]>(
    () =>
      args.workspaceStatuses.map((status) => ({
        key: status.id,
        worktreeIds: flattenLaneItemWorktrees(laneItems.get(status.id) ?? []).map(
          getWorktreeHostIdentity
        )
      })),
    [args.workspaceStatuses, laneItems]
  )
  useLayoutEffect(() => {
    if (!args.open) {
      return
    }
    return registerWorkspaceKanbanSidebarDropGroups(boardDragGroups)
  }, [args.open, boardDragGroups])
  const laneFullWorktreeIds = useMemo(
    () => new Map(boardDragGroups.map((group) => [group.key, group.worktreeIds])),
    [boardDragGroups]
  )
  const search = useWorkspaceKanbanSearch({
    open: args.open,
    worktrees: boardWorktrees,
    repoMap: args.repoMap
  })
  const laneViews = useMemo(
    () =>
      buildWorkspaceKanbanLaneViews({
        laneItems,
        matchingWorktreeIds: search.matchingWorktreeIds,
        query: search.filterQuery
      }),
    [laneItems, search.filterQuery, search.matchingWorktreeIds]
  )
  // Why from the lane views: a shown task card renders members the query itself did not match.
  const renderedBoardWorktrees = useMemo(
    () =>
      search.matchingWorktreeIds
        ? args.workspaceStatuses.flatMap((status) =>
            flattenLaneItemWorktrees(laneViews.get(status.id)?.items ?? [])
          )
        : boardWorktrees,
    [args.workspaceStatuses, boardWorktrees, laneViews, search.matchingWorktreeIds]
  )
  const renderedWorktreeIdentities = useMemo<ReadonlySet<string> | null>(
    () =>
      search.matchingWorktreeIds
        ? new Set(renderedBoardWorktrees.map(getWorktreeHostIdentity))
        : null,
    [renderedBoardWorktrees, search.matchingWorktreeIds]
  )
  const cardMembers = useMemo(() => buildWorkspaceKanbanCardMembers(laneItems), [laneItems])
  const taskMoveIdsByWorktreeId = useMemo(
    () => buildWorkspaceKanbanTaskMoveIndex(laneItems),
    [laneItems]
  )
  const taskMoveKeysByWorktreeKey = useMemo(
    () => buildWorkspaceKanbanTaskMoveKeyIndex(laneItems, worktreeById),
    [laneItems, worktreeById]
  )
  const activeWorktreeIdentity = args.activeWorktreeId
    ? composeWorktreeHostIdentity(
        args.activeWorkspaceExecutionHostId ?? undefined,
        args.activeWorktreeId
      )
    : null
  return {
    activeWorktreeIdentity,
    boardDragGroups,
    boardWorktrees,
    cardMembers,
    laneFullWorktreeIds,
    laneViews,
    renderedBoardWorktrees,
    /** Identities of the worktrees on screen under a query; null when nothing is filtered. */
    renderedWorktreeIdentities,
    search,
    taskMoveIdsByWorktreeId,
    taskMoveKeysByWorktreeKey,
    worktreeById,
    worktreeByKey
  }
}
