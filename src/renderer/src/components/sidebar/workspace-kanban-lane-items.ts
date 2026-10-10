import type { Repo } from '../../../../shared/repo-types'
import type {
  WorkspaceStatus,
  WorkspaceStatusDefinition,
  Worktree
} from '../../../../shared/worktree/types'
import { getWorktreeHostIdentity } from '../../../../shared/worktree/host-qualified-identity'
import { parseWorkspaceKey } from '../../../../shared/workspace-scope'
import { isWorktreeInSidebarSpace, type SidebarSpaceScope } from './sidebar-space-scope'
import type { TaskSectionInfo } from './worktree-list/grouping/row-types'
import { findTaskTitle } from './worktree-list/grouping/task-sections'
import { getTaskLaneKey } from './worktree-list/grouping/worktree-task-key'
import type { WorktreeTaskKeys } from './worktree-list/grouping/worktree-task-keys'

export type WorkspaceKanbanWorktreeLaneItem = {
  type: 'worktree'
  /** The worktree's host identity: the card id selection, drag and the virtualizer key on. */
  key: string
  worktree: Worktree
}

/** One card for every board worktree sharing a task key (Group by → Task). */
export type WorkspaceKanbanTaskLaneItem = {
  type: 'task'
  /** `task:<KEY>`; never a host identity, which always holds a `|`. */
  key: string
  /** The lane the card sits in: the least advanced one among its members. */
  status: WorkspaceStatus
  task: TaskSectionInfo
  /** Board-visible members in board order: what the card lists, selects and drags. */
  worktrees: readonly Worktree[]
  /** Every worktree id a move of the card carries, members hidden by filters or search included. */
  memberIds: readonly string[]
}

/** A project sub-header (Group by → Project): not a card, so never selected, dragged or counted. */
export type WorkspaceKanbanProjectHeaderLaneItem = {
  type: 'project-header'
  /** `project-header:<status>:<project key>`; unique on the board, never a card id. */
  key: string
  /** The sidebar's project section key, shared by this project's headers in every lane. */
  projectKey: string
  label: string
  /** Set for repo-backed projects; folder workspaces' groups have none. */
  repo?: Repo
  /** Cards under the header in this lane. */
  count: number
}

/** What a lane renders as a card, as opposed to a header. */
export type WorkspaceKanbanCardLaneItem =
  | WorkspaceKanbanWorktreeLaneItem
  | WorkspaceKanbanTaskLaneItem

export type WorkspaceKanbanLaneItem =
  | WorkspaceKanbanCardLaneItem
  | WorkspaceKanbanProjectHeaderLaneItem

export type WorkspaceKanbanTaskGrouping = {
  /** Built over every worktree, never a filtered list, so a filter cannot split a task. */
  taskKeys: WorktreeTaskKeys
  /** Per task key, the worktree ids a move carries; see collectWorkspaceKanbanTaskMoveIds. */
  moveIdsByTaskKey: ReadonlyMap<string, readonly string[]>
}

// Why a cache: unchanged worktrees keep their item, so memoized cards skip re-rendering.
const worktreeItemByWorktree = new WeakMap<Worktree, WorkspaceKanbanWorktreeLaneItem>()

export function toWorkspaceKanbanWorktreeLaneItem(
  worktree: Worktree
): WorkspaceKanbanWorktreeLaneItem {
  const cached = worktreeItemByWorktree.get(worktree)
  if (cached) {
    return cached
  }
  const item: WorkspaceKanbanWorktreeLaneItem = {
    type: 'worktree',
    key: getWorktreeHostIdentity(worktree),
    worktree
  }
  worktreeItemByWorktree.set(worktree, item)
  return item
}

export function toWorkspaceKanbanWorktreeLaneItems(
  worktrees: readonly Worktree[]
): WorkspaceKanbanWorktreeLaneItem[] {
  return worktrees.map(toWorkspaceKanbanWorktreeLaneItem)
}

const NO_WORKTREES: readonly Worktree[] = []

/** The worktrees behind an item; none for a header, which is why headers weigh 0 in drop math. */
export function getLaneItemWorktrees(item: WorkspaceKanbanLaneItem): readonly Worktree[] {
  if (item.type === 'task') {
    return item.worktrees
  }
  return item.type === 'worktree' ? [item.worktree] : NO_WORKTREES
}

export function isLaneCardItem(item: WorkspaceKanbanLaneItem): item is WorkspaceKanbanCardLaneItem {
  return item.type !== 'project-header'
}

/** Cards in a lane, headers left out: what lane badges count. */
export function countLaneCards(items: readonly WorkspaceKanbanLaneItem[]): number {
  let count = 0
  for (const item of items) {
    if (isLaneCardItem(item)) {
      count++
    }
  }
  return count
}

/** The lane's worktrees in card order, a task card's members contiguous. */
export function flattenLaneItemWorktrees(items: readonly WorkspaceKanbanLaneItem[]): Worktree[] {
  const worktrees: Worktree[] = []
  for (const item of items) {
    for (const worktree of getLaneItemWorktrees(item)) {
      worktrees.push(worktree)
    }
  }
  return worktrees
}

export function getLaneItemWorktreeIds(items: readonly WorkspaceKanbanLaneItem[]): string[] {
  return flattenLaneItemWorktrees(items).map((worktree) => worktree.id)
}

/** The board's task key; null for folder workspaces, which stay plain cards. */
function getBoardTaskKey(worktree: Worktree, taskKeys: WorktreeTaskKeys): string | null {
  return parseWorkspaceKey(worktree.id)?.type === 'folder' ? null : taskKeys.getTaskKey(worktree)
}

/**
 * Worktree ids per task key in the active space, for moves that must carry a whole task. Filters
 * and search do not narrow it; primaries, archived and folder workspaces are never task members.
 */
export function collectWorkspaceKanbanTaskMoveIds(args: {
  allWorktrees: readonly Worktree[]
  taskKeys: WorktreeTaskKeys
  spaceScope: SidebarSpaceScope | null
}): Map<string, string[]> {
  const idsByTaskKey = new Map<string, string[]>()
  for (const worktree of args.allWorktrees) {
    if (
      worktree.isMainWorktree ||
      worktree.isArchived ||
      (args.spaceScope && !isWorktreeInSidebarSpace(worktree, args.spaceScope))
    ) {
      continue
    }
    const taskKey = getBoardTaskKey(worktree, args.taskKeys)
    if (!taskKey) {
      continue
    }
    const ids = idsByTaskKey.get(taskKey)
    if (ids) {
      ids.push(worktree.id)
    } else {
      idsByTaskKey.set(taskKey, [worktree.id])
    }
  }
  return idsByTaskKey
}

function buildTaskLaneItem(args: {
  taskKey: string
  status: WorkspaceStatus
  worktrees: readonly Worktree[]
  moveIds: readonly string[] | undefined
}): WorkspaceKanbanTaskLaneItem {
  // Why the union: a board-visible member must move with its card even when it is a provisioned root.
  const memberIds = new Set(args.moveIds)
  for (const worktree of args.worktrees) {
    memberIds.add(worktree.id)
  }
  return {
    type: 'task',
    key: getTaskLaneKey(args.taskKey),
    status: args.status,
    task: {
      taskKey: args.taskKey,
      title: findTaskTitle(args.taskKey, args.worktrees),
      worktrees: args.worktrees.map((worktree) => ({
        worktreeId: worktree.id,
        repoId: worktree.repoId
      })),
      folderWorkspaceIds: []
    },
    worktrees: args.worktrees,
    memberIds: [...memberIds]
  }
}

/**
 * The cards of each lane. Without task grouping it is one card per worktree in the lane's order.
 * With it, every worktree that has a task key folds into one card per task, placed in the least
 * advanced lane holding a member, at that member's slot of the lane's sort.
 */
export function buildWorkspaceKanbanLaneItems(args: {
  worktreesByStatus: ReadonlyMap<WorkspaceStatus, readonly Worktree[]>
  workspaceStatuses: readonly WorkspaceStatusDefinition[]
  taskGrouping: WorkspaceKanbanTaskGrouping | null
}): Map<WorkspaceStatus, WorkspaceKanbanLaneItem[]> {
  const { worktreesByStatus, workspaceStatuses, taskGrouping } = args
  const lanes = new Map<WorkspaceStatus, WorkspaceKanbanLaneItem[]>()
  if (!taskGrouping) {
    for (const [status, worktrees] of worktreesByStatus) {
      lanes.set(status, toWorkspaceKanbanWorktreeLaneItems(worktrees))
    }
    return lanes
  }

  // Why status order: the first lane a task shows up in is its least advanced one.
  const taskKeyByWorktree = new Map<Worktree, string>()
  const tasks = new Map<string, { status: WorkspaceStatus; worktrees: Worktree[] }>()
  for (const { id: status } of workspaceStatuses) {
    for (const worktree of worktreesByStatus.get(status) ?? []) {
      const taskKey = getBoardTaskKey(worktree, taskGrouping.taskKeys)
      if (!taskKey) {
        continue
      }
      taskKeyByWorktree.set(worktree, taskKey)
      const task = tasks.get(taskKey)
      if (task) {
        task.worktrees.push(worktree)
      } else {
        tasks.set(taskKey, { status, worktrees: [worktree] })
      }
    }
  }

  const placedTaskKeys = new Set<string>()
  for (const [status, worktrees] of worktreesByStatus) {
    const items: WorkspaceKanbanLaneItem[] = []
    for (const worktree of worktrees) {
      const taskKey = taskKeyByWorktree.get(worktree)
      const task = taskKey ? tasks.get(taskKey) : undefined
      if (!taskKey || !task) {
        items.push(toWorkspaceKanbanWorktreeLaneItem(worktree))
        continue
      }
      if (task.status !== status || placedTaskKeys.has(taskKey)) {
        continue
      }
      placedTaskKeys.add(taskKey)
      items.push(
        buildTaskLaneItem({
          taskKey,
          status,
          worktrees: task.worktrees,
          moveIds: taskGrouping.moveIdsByTaskKey.get(taskKey)
        })
      )
    }
    lanes.set(status, items)
  }
  return lanes
}

/** Board-visible task member id → every id its card's move carries. Empty without task cards. */
export function buildWorkspaceKanbanTaskMoveIndex(
  laneItems: ReadonlyMap<WorkspaceStatus, readonly WorkspaceKanbanLaneItem[]>
): Map<string, readonly string[]> {
  const moveIdsByWorktreeId = new Map<string, readonly string[]>()
  for (const items of laneItems.values()) {
    for (const item of items) {
      if (item.type !== 'task') {
        continue
      }
      for (const worktree of item.worktrees) {
        moveIdsByWorktreeId.set(worktree.id, item.memberIds)
      }
    }
  }
  return moveIdsByWorktreeId
}

/** Widens a board move so a task card's member carries every worktree of its task. */
export function expandWorkspaceKanbanTaskMoveIds(
  worktreeIds: readonly string[],
  moveIdsByWorktreeId: ReadonlyMap<string, readonly string[]>
): readonly string[] {
  if (moveIdsByWorktreeId.size === 0) {
    return worktreeIds
  }
  const expanded = new Set<string>()
  for (const worktreeId of worktreeIds) {
    for (const id of moveIdsByWorktreeId.get(worktreeId) ?? [worktreeId]) {
      expanded.add(id)
    }
  }
  return [...expanded]
}

/** Value equality, so a task card can keep its TaskSectionInfo, and its children's memos, across rebuilds. */
export function isSameTaskSectionInfo(a: TaskSectionInfo, b: TaskSectionInfo): boolean {
  return (
    a.taskKey === b.taskKey &&
    a.title === b.title &&
    a.worktrees.length === b.worktrees.length &&
    a.worktrees.every(
      (member, index) =>
        member.worktreeId === b.worktrees[index]?.worktreeId &&
        member.repoId === b.worktrees[index]?.repoId
    ) &&
    a.folderWorkspaceIds.length === b.folderWorkspaceIds.length &&
    a.folderWorkspaceIds.every((id, index) => id === b.folderWorkspaceIds[index])
  )
}
