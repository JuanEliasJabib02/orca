import type { Worktree } from '../../../../../../shared/worktree/types'
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
  'repoId' | 'linkedWorkItem' | 'branch' | 'displayName' | 'isMainWorktree' | 'isArchived'
>

/** Resolves every worktree's task key against one worktree set, so all callers agree. */
export type WorktreeTaskKeys = {
  getTaskKey(worktree: TaskKeyWorktree): string | null
  getLaneKey(worktree: TaskKeyWorktree): string
}

type SharedNameEntry = { firstRepoId: string; shared: boolean; casing: string }

// Why: a lane key of `task:none` is the "No task" section, so a branch called "none" must never form a task.
const RESERVED_NAME_KEY = NO_TASK_LANE_KEY.slice(TASK_LANE_PREFIX.length)

/** The last `/` segment of the branch; null where a name must never form a task (main, detached, folder). */
function getBranchNameSegment(worktree: TaskKeyWorktree): string | null {
  if (worktree.isMainWorktree) {
    return null
  }
  const segment = branchName(worktree.branch).trim().split('/').at(-1)?.trim()
  if (!segment || segment.toLowerCase() === RESERVED_NAME_KEY || !isUsableTaskKey(segment)) {
    return null
  }
  return segment
}

function findSharedBranchNames(
  worktrees: readonly TaskKeyWorktree[],
  ticketKeyByWorktree: Map<TaskKeyWorktree, string | null>
): Map<string, string> {
  const byLowerName = new Map<string, SharedNameEntry>()
  for (const worktree of worktrees) {
    // Why: archived workspaces are not shown, so they must not keep a task alive.
    if (worktree.isArchived) {
      continue
    }
    const ticketKey = getTicketTaskKey(getWorktreeTaskKeySource(worktree))
    ticketKeyByWorktree.set(worktree, ticketKey)
    const segment = ticketKey ? null : getBranchNameSegment(worktree)
    if (!segment) {
      continue
    }
    const lowerName = segment.toLowerCase()
    const entry = byLowerName.get(lowerName)
    if (!entry) {
      byLowerName.set(lowerName, { firstRepoId: worktree.repoId, shared: false, casing: segment })
      continue
    }
    entry.shared ||= entry.firstRepoId !== worktree.repoId
    // Why smallest, not first seen: callers order worktrees differently and the casing is the task's identity.
    if (segment < entry.casing) {
      entry.casing = segment
    }
  }
  const shared = new Map<string, string>()
  for (const [lowerName, entry] of byLowerName) {
    if (entry.shared) {
      shared.set(lowerName, entry.casing)
    }
  }
  return shared
}

/**
 * Ticket key first, else the branch name when key-less, non-archived worktrees in 2+ repos share it,
 * else null. Build once per grouping pass over EVERY worktree, never a filtered list, so a filter
 * cannot split a task (O(n)); look up per worktree.
 */
export function buildWorktreeTaskKeys(worktrees: readonly TaskKeyWorktree[]): WorktreeTaskKeys {
  // Why a cache: lookups repeat per grouping step and the ticket regexes are the costly part.
  const ticketKeyByWorktree = new Map<TaskKeyWorktree, string | null>()
  const sharedNames = findSharedBranchNames(worktrees, ticketKeyByWorktree)

  function getTaskKey(worktree: TaskKeyWorktree): string | null {
    const ticketKey = ticketKeyByWorktree.has(worktree)
      ? ticketKeyByWorktree.get(worktree)
      : getTicketTaskKey(getWorktreeTaskKeySource(worktree))
    if (ticketKey) {
      return ticketKey
    }
    const segment = sharedNames.size > 0 ? getBranchNameSegment(worktree) : null
    return segment ? (sharedNames.get(segment.toLowerCase()) ?? null) : null
  }

  return { getTaskKey, getLaneKey: (worktree) => getTaskLaneKey(getTaskKey(worktree)) }
}

/** Ticket-only keys, for callers with no worktree set to share branch names across. */
export const TICKET_ONLY_TASK_KEYS: WorktreeTaskKeys = buildWorktreeTaskKeys([])

/**
 * The task key the sidebar files `worktree` under; `allWorktrees` is every worktree to share names
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
