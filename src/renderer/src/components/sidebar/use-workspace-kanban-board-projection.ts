import { useLayoutEffect, useMemo } from 'react'
import { useAppStore } from '@/store'
import { useVisibleWorkspaceKanbanWorktreeIds } from './use-visible-workspace-kanban-worktree-ids'
import { groupWorkspaceKanbanWorktrees } from './workspace-kanban-worktree-groups'
import { buildWorkspaceKanbanLaneViews } from './workspace-kanban-search'
import { useWorkspaceKanbanSearch } from './use-workspace-kanban-search'
import { registerWorkspaceKanbanSidebarDropGroups } from './workspace-kanban-sidebar-drop'
import { buildUnambiguousWorktreeIdIndex } from './worktree-unambiguous-id-index'
import { useActiveSidebarSpaceScope } from './use-active-sidebar-space'
import { getSidebarTaskKeys } from './worktree-list/grouping/worktree-task-keys'
import {
  buildWorkspaceKanbanLaneItems,
  buildWorkspaceKanbanTaskMoveIndex,
  collectWorkspaceKanbanTaskMoveIds,
  flattenLaneItemWorktrees,
  getLaneItemWorktreeIds,
  type WorkspaceKanbanTaskGrouping
} from './workspace-kanban-lane-items'
import { buildWorkspaceKanbanCardMembers } from './workspace-kanban-card-selection'
import { sectionWorkspaceKanbanLaneItemsByProject } from './workspace-kanban-project-sections'
import { useWorkspaceKanbanProjectSections } from './use-workspace-kanban-project-sections'
import {
  composeWorktreeHostIdentity,
  getWorktreeHostIdentity
} from '../../../../shared/worktree/host-qualified-identity'
import type { Worktree } from '../../../../shared/worktree/types'
import type { ExecutionHostId } from '../../../../shared/execution-host'
import type { WorktreeDragGroup } from './worktree-manual-order'
import type { useRepoMap } from '@/store/selectors'

export function useWorkspaceKanbanBoardProjection(args: {
  activeWorktreeId: string | null
  activeWorkspaceExecutionHostId: ExecutionHostId | null
  allWorktrees: readonly Worktree[]
  open: boolean
  repoMap: ReturnType<typeof useRepoMap>
  sortBy: ReturnType<typeof useAppStore.getState>['sortBy']
  workspaceStatuses: ReturnType<typeof useAppStore.getState>['workspaceStatuses']
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
  // Why card order: manual order, sidebar-drop groups and range selection must match the screen.
  const boardWorktrees = useMemo(
    () =>
      args.workspaceStatuses.flatMap((status) =>
        flattenLaneItemWorktrees(laneItems.get(status.id) ?? [])
      ),
    [args.workspaceStatuses, laneItems]
  )
  const boardDragGroups = useMemo<WorktreeDragGroup[]>(
    () =>
      args.workspaceStatuses.map((status) => ({
        key: status.id,
        worktreeIds: getLaneItemWorktreeIds(laneItems.get(status.id) ?? [])
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
    worktreeById
  }
}
