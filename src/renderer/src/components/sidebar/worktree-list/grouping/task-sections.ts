import { Ticket, TicketSlash } from 'lucide-react'
import type { Repo } from '../../../../../../shared/repo-types'
import type { Worktree } from '../../../../../../shared/worktree/types'
import type { ExecutionHostId } from '../../../../../../shared/execution-host'
import { translate } from '@/i18n/i18n'
import { getLaneHostWorktreeCounts, getLaneHostWorktreeIds } from './host-labels'
import type { OrderedGroupEntry, WorktreeGroupEntry } from './project-grouping'
import type { GroupHeaderRow } from './row-types'
import {
  NO_TASK_LANE_KEY,
  getFolderWorkspaceTaskKeySource,
  getTaskKeyFromLaneKey,
  getTaskTitle,
  getWorktreeTaskKeySource
} from './worktree-task-key'
import type { WorktreeTaskKeys } from './worktree-task-keys'

export const TASK_GROUP_META = {
  tone: 'text-foreground',
  icon: Ticket
} as const

export const NO_TASK_GROUP_META = {
  get label() {
    return translate('auto.components.sidebar.worktree.list.groups.noTask', 'No task')
  },
  tone: 'text-muted-foreground',
  icon: TicketSlash
} as const

/** Provisional lane label; the header swaps in the Jira title once it sees every member. */
export function getTaskLaneLabel(laneKey: string): string {
  return getTaskKeyFromLaneKey(laneKey) ?? NO_TASK_GROUP_META.label
}

/** Every worktree per task lane, so a header can name members the Pinned section took. */
export function groupWorktreesByTaskLane(
  worktrees: readonly Worktree[],
  taskKeys: WorktreeTaskKeys
): Map<string, Worktree[]> {
  const byLaneKey = new Map<string, Worktree[]>()
  for (const worktree of worktrees) {
    const laneKey = taskKeys.getLaneKey(worktree)
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

/** Most recently active task first, ties by key; "No task" always last. */
export function sortTaskGroupEntries(
  grouped: ReadonlyMap<string, WorktreeGroupEntry>
): OrderedGroupEntry[] {
  const ranked = [...grouped.entries()]
    .filter(([key]) => key !== NO_TASK_LANE_KEY)
    .map((entry) => ({ entry, latest: getLatestActivityAt(entry[1]) }))
  ranked.sort((a, b) => {
    // Why the equality guard: two empty lanes are both -Infinity, and -Infinity minus itself is NaN.
    const byActivity = a.latest === b.latest ? 0 : b.latest - a.latest
    return byActivity || a.entry[0].localeCompare(b.entry[0])
  })
  const ordered = ranked.map(({ entry }) => entry)
  const noTask = grouped.get(NO_TASK_LANE_KEY)
  if (noTask) {
    ordered.push([NO_TASK_LANE_KEY, noTask])
  }
  return ordered
}

function findTaskTitle(
  taskKey: string,
  worktrees: readonly Worktree[],
  group: WorktreeGroupEntry
): string | null {
  for (const worktree of worktrees) {
    const title = getTaskTitle(getWorktreeTaskKeySource(worktree), taskKey)
    if (title) {
      return title
    }
  }
  for (const { folderWorkspace } of group.folderWorkspaces ?? []) {
    const title = getTaskTitle(getFolderWorkspaceTaskKeySource(folderWorkspace), taskKey)
    if (title) {
      return title
    }
  }
  return null
}

function getTaskHeaderLabel(taskKey: string | null, title: string | null): string {
  if (!taskKey) {
    return NO_TASK_GROUP_META.label
  }
  if (!title) {
    return taskKey
  }
  return translate(
    'auto.components.sidebar.worktree.list.groups.taskWithTitle',
    '{{value0}} · {{value1}}',
    {
      value0: taskKey,
      value1: title
    }
  )
}

/**
 * A Group by → Task header. `taskWorktrees` is every visible worktree with this key, which
 * can exceed `group.items` when the Pinned section holds some of them.
 */
export function buildTaskSectionHeader(args: {
  key: string
  group: WorktreeGroupEntry
  taskWorktrees: readonly Worktree[]
  repoMap: Map<string, Repo>
  defaultHostId: ExecutionHostId
}): GroupHeaderRow {
  const { key, group, taskWorktrees, repoMap, defaultHostId } = args
  const folderPairs = group.folderWorkspaces ?? []
  const taskKey = getTaskKeyFromLaneKey(key)
  const title = taskKey ? findTaskTitle(taskKey, taskWorktrees, group) : null
  const meta = taskKey ? TASK_GROUP_META : NO_TASK_GROUP_META
  return {
    type: 'header',
    key,
    label: getTaskHeaderLabel(taskKey, title),
    count: group.items.length + folderPairs.length,
    tone: meta.tone,
    icon: meta.icon,
    hostWorktreeCounts: getLaneHostWorktreeCounts(group.items, folderPairs, repoMap, defaultHostId),
    hostWorktreeIds: getLaneHostWorktreeIds(group.items, folderPairs, repoMap, defaultHostId),
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
