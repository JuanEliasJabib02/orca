import type { Worktree } from '../../../../../../shared/worktree/types'
import { parseWorkspaceKey } from '../../../../../../shared/workspace-scope'
import { branchName } from '../../../../lib/git-utils'
import { isUsableTaskKey } from '../../../../store/slices/ui/ui-slice-task-key-record'
import type { WorktreeGroupBy } from './row-types'
import {
  NO_TASK_LANE_KEY,
  TASK_LANE_PREFIX,
  getTaskKey as getTicketTaskKey,
  getTaskLaneKey,
  getWorktreeTaskKeySource
} from './worktree-task-key'

export type TaskKeyWorktree = Pick<
  Worktree,
  | 'id'
  | 'repoId'
  | 'linkedWorkItem'
  | 'branch'
  | 'displayName'
  | 'isMainWorktree'
  | 'isArchived'
  | 'ephemeralVmCheckoutMode'
>

/** Resolves every worktree's task key against one worktree set, so all callers agree. */
export type WorktreeTaskKeys = {
  getTaskKey(worktree: TaskKeyWorktree): string | null
  getLaneKey(worktree: TaskKeyWorktree): string
}

// Why: a lane key of `task:none` is the "No task" section, so a name "none" must never form a task.
const RESERVED_NAME_KEY = NO_TASK_LANE_KEY.slice(TASK_LANE_PREFIX.length)

function toTaskName(raw: string | undefined): string | null {
  const name = raw?.trim()
  return name && name.toLowerCase() !== RESERVED_NAME_KEY && isUsableTaskKey(name) ? name : null
}

/**
 * The name a key-less worktree's task goes by: its branch's last `/` segment, else (e.g. detached
 * HEAD) its display name. Null for main checkouts, archived worktrees and folder workspaces.
 * A provisioned VM root is the recipe-created workspace, not a project root, so it is named.
 */
function getWorktreeTaskName(worktree: TaskKeyWorktree): string | null {
  if (
    (worktree.isMainWorktree && worktree.ephemeralVmCheckoutMode !== 'provisioned-root') ||
    worktree.isArchived ||
    parseWorkspaceKey(worktree.id)?.type === 'folder'
  ) {
    return null
  }
  return (
    toTaskName(branchName(worktree.branch).split('/').at(-1)) ?? toTaskName(worktree.displayName)
  )
}

/** Smallest casing per lower-cased name across the set, so a merged task has one label. */
function indexNameCasings(
  worktrees: readonly TaskKeyWorktree[],
  ticketKeyByWorktree: Map<TaskKeyWorktree, string | null>
): Map<string, string> {
  const casingByLowerName = new Map<string, string>()
  for (const worktree of worktrees) {
    const ticketKey = getTicketTaskKey(getWorktreeTaskKeySource(worktree))
    ticketKeyByWorktree.set(worktree, ticketKey)
    const name = ticketKey ? null : getWorktreeTaskName(worktree)
    if (!name) {
      continue
    }
    const lowerName = name.toLowerCase()
    const casing = casingByLowerName.get(lowerName)
    // Why smallest, not first seen: callers order worktrees differently and the casing is the task's identity.
    if (casing === undefined || name < casing) {
      casingByLowerName.set(lowerName, name)
    }
  }
  return casingByLowerName
}

/**
 * Ticket key first, else the worktree's name (see getWorktreeTaskName): every named workspace is a
 * task, and the same name in any repo is the same task, case-insensitively. Build once per grouping
 * pass over EVERY worktree, never a filtered list, so a filter cannot change a task's casing (O(n)).
 */
export function buildWorktreeTaskKeys(worktrees: readonly TaskKeyWorktree[]): WorktreeTaskKeys {
  // Why a cache: lookups repeat per grouping step and the ticket regexes are the costly part.
  const ticketKeyByWorktree = new Map<TaskKeyWorktree, string | null>()
  const casingByLowerName = indexNameCasings(worktrees, ticketKeyByWorktree)

  function getTaskKey(worktree: TaskKeyWorktree): string | null {
    const ticketKey = ticketKeyByWorktree.has(worktree)
      ? ticketKeyByWorktree.get(worktree)
      : getTicketTaskKey(getWorktreeTaskKeySource(worktree))
    if (ticketKey) {
      return ticketKey
    }
    const name = getWorktreeTaskName(worktree)
    return name ? (casingByLowerName.get(name.toLowerCase()) ?? name) : null
  }

  return { getTaskKey, getLaneKey: (worktree) => getTaskLaneKey(getTaskKey(worktree)) }
}

function getTicketOnlyTaskKey(worktree: TaskKeyWorktree): string | null {
  return getTicketTaskKey(getWorktreeTaskKeySource(worktree))
}

/** Ticket keys only, never names: what every Group by other than Task files worktrees under. */
export const TICKET_ONLY_TASK_KEYS: WorktreeTaskKeys = {
  getTaskKey: getTicketOnlyTaskKey,
  getLaneKey: (worktree) => getTaskLaneKey(getTicketOnlyTaskKey(worktree))
}

/**
 * The task key the sidebar files `worktree` under; `allWorktrees` is every worktree to merge names
 * across, unfiltered (`Object.values(worktreesByRepo).flat()`). Builds the index per call: reuse
 * `buildWorktreeTaskKeys` when resolving many.
 */
export function getWorktreeTaskKey(
  worktree: TaskKeyWorktree,
  allWorktrees: readonly TaskKeyWorktree[]
): string | null {
  return buildWorktreeTaskKeys(allWorktrees).getTaskKey(worktree)
}

const taskKeysByAllWorktrees = new WeakMap<readonly TaskKeyWorktree[], WorktreeTaskKeys>()

/** `buildWorktreeTaskKeys` cached per store snapshot; `allWorktrees` must not be mutated or filtered. */
export function getTaskKeysForAllWorktrees(allWorktrees: readonly Worktree[]): WorktreeTaskKeys {
  const cached = taskKeysByAllWorktrees.get(allWorktrees)
  if (cached) {
    return cached
  }
  const taskKeys = buildWorktreeTaskKeys(allWorktrees)
  taskKeysByAllWorktrees.set(allWorktrees, taskKeys)
  return taskKeys
}

/** The one index every sidebar step shares: all worktrees in task mode, ticket-only otherwise. */
export function getSidebarTaskKeys(
  groupBy: WorktreeGroupBy,
  allWorktrees: readonly Worktree[]
): WorktreeTaskKeys {
  return groupBy === 'task' ? getTaskKeysForAllWorktrees(allWorktrees) : TICKET_ONLY_TASK_KEYS
}
