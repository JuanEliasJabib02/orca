import React, { useCallback, useLayoutEffect, useMemo, useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { Repo } from '../../../../shared/repo-types'
import type { WorkspaceStatus, Worktree } from '../../../../shared/worktree/types'
import { getWorktreeHostIdentity } from '../../../../shared/worktree/host-qualified-identity'
import WorkspaceKanbanCard from './WorkspaceKanbanCard'
import WorkspaceKanbanTaskCard from './WorkspaceKanbanTaskCard'
import WorkspaceKanbanProjectHeader from './WorkspaceKanbanProjectHeader'
import { registerWorkspaceKanbanVirtualLaneLayout } from './workspace-kanban-virtual-lane-layout'
import {
  getLaneItemWorktrees,
  type WorkspaceKanbanCardLaneItem,
  type WorkspaceKanbanLaneItem,
  type WorkspaceKanbanTaskLaneItem
} from './workspace-kanban-lane-items'

// Why: board cards are uniform one-line rows; a close estimate keeps the first
// virtual window right so the lane does not reflow once cards measure.
const WORKSPACE_BOARD_CARD_ESTIMATED_HEIGHT = 36
// Why: a task card is a header plus one row per member, so its estimate grows with them.
const WORKSPACE_BOARD_TASK_CARD_HEADER_HEIGHT = 34
const WORKSPACE_BOARD_TASK_CARD_ROW_HEIGHT = 26
const WORKSPACE_BOARD_PROJECT_HEADER_HEIGHT = 24
// Matches the `space-y-2` rhythm the lane used before virtualization.
const WORKSPACE_BOARD_CARD_GAP = 8
const WORKSPACE_BOARD_CARD_OVERSCAN = 6

function estimateWorkspaceBoardCardSize(item: WorkspaceKanbanLaneItem | undefined): number {
  if (item?.type === 'project-header') {
    return WORKSPACE_BOARD_PROJECT_HEADER_HEIGHT
  }
  return item?.type === 'task'
    ? WORKSPACE_BOARD_TASK_CARD_HEADER_HEIGHT +
        item.worktrees.length * WORKSPACE_BOARD_TASK_CARD_ROW_HEIGHT
    : WORKSPACE_BOARD_CARD_ESTIMATED_HEIGHT
}

// Why every member: a task card shows as selected only when its whole selection does.
function isTaskCardSelected(
  item: WorkspaceKanbanTaskLaneItem,
  selectedWorktreeIds: ReadonlySet<string>
): boolean {
  return (
    item.worktrees.length > 0 &&
    item.worktrees.every((worktree) => selectedWorktreeIds.has(getWorktreeHostIdentity(worktree)))
  )
}

type WorkspaceKanbanLaneCardListProps = {
  items: readonly WorkspaceKanbanLaneItem[]
  repoMap: Map<string, Repo>
  activeWorktreeIdentity: string | null
  scrollRef: React.RefObject<HTMLDivElement | null>
  selectedWorktreeIds: ReadonlySet<string>
  selectedWorktrees: readonly Worktree[]
  nativeDragEnabled: boolean
  onActivate: () => void
  onSelectionGesture: (event: React.MouseEvent<HTMLElement>, worktreeId: string) => boolean
  onContextMenuSelect: (
    event: React.MouseEvent<HTMLElement>,
    worktree: Worktree
  ) => readonly Worktree[]
  onAssignWorkspaceStatus?: (worktreeIds: readonly string[], status: WorkspaceStatus) => void
}

function WorkspaceKanbanLaneCardList({
  items,
  repoMap,
  activeWorktreeIdentity,
  scrollRef,
  selectedWorktreeIds,
  selectedWorktrees,
  nativeDragEnabled,
  onActivate,
  onSelectionGesture,
  onContextMenuSelect,
  onAssignWorkspaceStatus
}: WorkspaceKanbanLaneCardListProps): React.JSX.Element {
  const spacerRef = useRef<HTMLDivElement | null>(null)
  const itemIds = useMemo(() => items.map((item) => item.key), [items])
  const itemWorktreeIds = useMemo(
    () => items.map((item) => getLaneItemWorktrees(item).map((worktree) => worktree.id)),
    [items]
  )
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: useCallback(
      (index: number) => estimateWorkspaceBoardCardSize(items[index]),
      [items]
    ),
    getItemKey: useCallback((index: number) => items[index]?.key ?? index, [items]),
    overscan: WORKSPACE_BOARD_CARD_OVERSCAN,
    gap: WORKSPACE_BOARD_CARD_GAP,
    // Why: sync-flushing rich card renders inside the scroll listener stalls the
    // wheel; async + overscan keeps the lane filled without blocking input.
    useFlushSync: false
  })

  useLayoutEffect(() => {
    const scrollElement = scrollRef.current
    const spacerElement = spacerRef.current
    if (!scrollElement || !spacerElement) {
      return
    }
    return registerWorkspaceKanbanVirtualLaneLayout({
      scrollElement,
      spacerElement,
      getItemIds: () => itemIds,
      getItemWorktreeIds: () => itemWorktreeIds,
      getMeasurements: () => virtualizer.measurementsCache
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- virtualizer is a stable instance (useVirtualizer holds it in useState), and getMeasurements reads measurementsCache off it live.
  }, [itemIds, itemWorktreeIds, scrollRef])

  const renderCard = (item: WorkspaceKanbanCardLaneItem, laneIndex: number): React.JSX.Element => {
    const isSelected =
      item.type === 'task'
        ? isTaskCardSelected(item, selectedWorktreeIds)
        : selectedWorktreeIds.has(item.key)
    const contextWorktrees =
      isSelected && selectedWorktrees.length > 0 ? selectedWorktrees : undefined
    return item.type === 'task' ? (
      <WorkspaceKanbanTaskCard
        item={item}
        laneIndex={laneIndex}
        repoMap={repoMap}
        activeWorktreeIdentity={activeWorktreeIdentity}
        isSelected={isSelected}
        selectedWorktrees={contextWorktrees}
        onActivate={onActivate}
        onSelectionGesture={onSelectionGesture}
        onAssignWorkspaceStatus={onAssignWorkspaceStatus}
      />
    ) : (
      <WorkspaceKanbanCard
        worktree={item.worktree}
        laneIndex={laneIndex}
        repo={repoMap.get(item.worktree.repoId)}
        isActive={activeWorktreeIdentity === item.key}
        isSelected={isSelected}
        nativeDragEnabled={nativeDragEnabled}
        selectedWorktrees={contextWorktrees}
        onActivate={onActivate}
        onSelectionGesture={onSelectionGesture}
        onContextMenuSelect={onContextMenuSelect}
        onAssignWorkspaceStatus={onAssignWorkspaceStatus}
      />
    )
  }

  return (
    <div
      ref={spacerRef}
      className="relative w-full"
      style={{ height: `${virtualizer.getTotalSize()}px` }}
    >
      {virtualizer.getVirtualItems().map((virtualItem) => {
        const item = items[virtualItem.index]
        if (!item) {
          return null
        }
        return (
          <div
            key={virtualItem.key}
            data-index={virtualItem.index}
            ref={virtualizer.measureElement}
            className="absolute left-0 top-0 w-full"
            style={{ transform: `translateY(${virtualItem.start}px)` }}
          >
            {item.type === 'project-header' ? (
              <WorkspaceKanbanProjectHeader item={item} />
            ) : (
              renderCard(item, virtualItem.index)
            )}
          </div>
        )
      })}
    </div>
  )
}

export default React.memo(WorkspaceKanbanLaneCardList)
