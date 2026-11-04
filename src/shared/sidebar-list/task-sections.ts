import type { Repo } from '../repo-types'
import type { Worktree } from '../worktree/types'
import type { ExecutionHostId } from '../execution-host'
import { getLaneHostWorktreeCounts, getLaneHostWorktreeIds } from './host-labels'
import type { OrderedGroupEntry, WorktreeGroupEntry } from './worktree-group-entry'
import type { GroupHeaderRow, RepoOfWorktree, SidebarHeaderIcon } from './row-types'
import { SERVERS_LANE_KEY, getTaskModeLaneKey } from './server-root-lane'
import {
  NO_TASK_LANE_KEY,
  getFolderWorkspaceTaskKeySource,
  getTaskKeyFromLaneKey,
  getTaskTitle,
  getWorktreeTaskKeySource
} from './worktree-task-key'
import type { WorktreeTaskKeys } from './worktree-task-keys'

/** Every worktree per Group by → Task section, so a header can name members the Pinned section took. */
export function groupWorktreesByTaskLane(
  worktrees: readonly Worktree[],
  taskKeys: WorktreeTaskKeys,
  repoMap: ReadonlyMap<string, Repo>
): Map<string, Worktree[]> {
  const byLaneKey = new Map<string, Worktree[]>()
  for (const worktree of worktrees) {
    const laneKey = getTaskModeLaneKey(worktree, repoMap, taskKeys)
    const members = byLaneKey.get(laneKey)
    if (members) {
      members.push(worktree)
    } else {
      byLaneKey.set(laneKey, [worktree])
    }
  }
  return byLaneKey
}

function getLatestActivityAt(group: WorktreeGroupEntry): number {
  let latest = Number.NEGATIVE_INFINITY
  for (const worktree of group.items) {
    latest = Math.max(latest, worktree.lastActivityAt)
  }
  for (const { folderWorkspace } of group.folderWorkspaces ?? []) {
    latest = Math.max(latest, folderWorkspace.lastActivityAt)
  }
  return latest
}

/** Most recently active task first, ties by key; then "No task", then "Servers", always last. */
export function sortTaskGroupEntries(
  grouped: ReadonlyMap<string, WorktreeGroupEntry>
): OrderedGroupEntry[] {
  const ranked = [...grouped.entries()]
    .filter(([key]) => key !== NO_TASK_LANE_KEY && key !== SERVERS_LANE_KEY)
    .map((entry) => ({ entry, latest: getLatestActivityAt(entry[1]) }))
  ranked.sort((a, b) => {
    // Why the equality guard: two empty lanes are both -Infinity, and -Infinity minus itself is NaN.
    const byActivity = a.latest === b.latest ? 0 : b.latest - a.latest
    return byActivity || a.entry[0].localeCompare(b.entry[0])
  })
  const ordered = ranked.map(({ entry }) => entry)
  for (const trailingKey of [NO_TASK_LANE_KEY, SERVERS_LANE_KEY]) {
    const trailing = grouped.get(trailingKey)
    if (trailing) {
      ordered.push([trailingKey, trailing])
    }
  }
  return ordered
}

function findLinkedTaskTitle(
  taskKey: string,
  worktrees: readonly Worktree[],
  group: WorktreeGroupEntry | undefined
): string | null {
  for (const worktree of worktrees) {
    const title = getTaskTitle(getWorktreeTaskKeySource(worktree), taskKey)
    if (title) {
      return title
    }
  }
  for (const { folderWorkspace } of group?.folderWorkspaces ?? []) {
    const title = getTaskTitle(getFolderWorkspaceTaskKeySource(folderWorkspace), taskKey)
    if (title) {
      return title
    }
  }
  return null
}

/** The linked Jira title of the first member carrying `taskKey`; `group` adds its folder workspaces. */
export function findTaskTitle(
  taskKey: string,
  worktrees: readonly Worktree[],
  group?: WorktreeGroupEntry
): string | null {
  const title = findLinkedTaskTitle(taskKey, worktrees, group)
  // Why: a title that only repeats the key would print it twice ("sidebar · sidebar").
  return title !== null && title.toLowerCase() === taskKey.toLowerCase() ? null : title
}

function getTaskHeaderIcon(laneKey: string, taskKey: string | null): SidebarHeaderIcon {
  if (taskKey) {
    return { kind: 'task' }
  }
  return laneKey === SERVERS_LANE_KEY ? { kind: 'servers' } : { kind: 'no-task' }
}

/**
 * A Group by → Task header (a task, "No task" or "Servers"). `taskWorktrees` is every visible
 * worktree of the section, which can exceed `group.items` when the Pinned section holds some.
 * A task's data label is its key; clients add the title and name "No task"/"Servers" from the icon.
 */
export function buildTaskSectionHeader(args: {
  key: string
  group: WorktreeGroupEntry
  taskWorktrees: readonly Worktree[]
  repoOf: RepoOfWorktree
  defaultHostId: ExecutionHostId
}): GroupHeaderRow {
  const { key, group, taskWorktrees, repoOf, defaultHostId } = args
  const folderPairs = group.folderWorkspaces ?? []
  const taskKey = getTaskKeyFromLaneKey(key)
  const title = taskKey ? findTaskTitle(taskKey, taskWorktrees, group) : null
  return {
    type: 'header',
    key,
    ...(taskKey ? { label: taskKey } : {}),
    count: group.items.length + folderPairs.length,
    icon: getTaskHeaderIcon(key, taskKey),
    hostWorktreeCounts: getLaneHostWorktreeCounts(group.items, folderPairs, repoOf, defaultHostId),
    hostWorktreeIds: getLaneHostWorktreeIds(group.items, folderPairs, repoOf, defaultHostId),
    worktreeIds: group.items.map((worktree) => worktree.id),
    task: {
      taskKey,
      title,
      worktrees: taskWorktrees.map((worktree) => ({
        worktreeId: worktree.id,
        repoId: worktree.repoId
      })),
      folderWorkspaceIds: folderPairs.map(({ folderWorkspace }) => folderWorkspace.id)
    }
  }
}
