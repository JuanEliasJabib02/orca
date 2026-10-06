import type { FolderWorkspace } from '../../../../../../shared/folder-workspace-types'
import type { WorkspaceLinkedItem, Worktree } from '../../../../../../shared/worktree/types'
import { branchName } from '../../../../lib/git-utils'

/** What a workspace's task key is read from, in priority order. */
export type TaskKeySource = {
  linkedWorkItem?: Pick<WorkspaceLinkedItem, 'provider' | 'jiraIdentifier' | 'title'> | null
  /** Absent for folder workspaces, which have no branch. */
  branch?: string
  displayName: string
}

// Why a 2–6 char prefix: longer words like "release" in "release-2024" must not read as a key.
// Why the letters-only arm: with no separator a digit-ending prefix would split "ax3356" as AX335-6.
// Why 2+ digits without a separator: words like "vue3" or "md5" must not read as VUE-3 / MD-5.
const TASK_KEY_PATTERN =
  /(?<![A-Za-z0-9])(?:([A-Za-z][A-Za-z0-9]{1,5})[-_ ](\d{1,6})|([A-Za-z]{2,6})(\d{2,6}))(?![A-Za-z0-9])/

export const TASK_LANE_PREFIX = 'task:'
export const NO_TASK_LANE_KEY = `${TASK_LANE_PREFIX}none`

/** First Jira-style key in free text, normalized to `AX-3356`; case-, space- and underscore-tolerant. */
export function findTaskKey(text: string): string | null {
  const match = TASK_KEY_PATTERN.exec(text)
  const prefix = match?.[1] ?? match?.[3]
  const digits = match?.[2] ?? match?.[4]
  return prefix && digits ? `${prefix.toUpperCase()}-${digits}` : null
}

function getLinkedJiraKey(item: TaskKeySource['linkedWorkItem']): string | null {
  const identifier = item?.provider === 'jira' ? item.jiraIdentifier?.trim() : undefined
  if (!identifier) {
    return null
  }
  // Why the raw fallback: a linked id is authoritative even when its project key is longer than free text allows.
  return findTaskKey(identifier) ?? identifier.toUpperCase()
}

function getBranchTaskKey(branch: string): string | null {
  // Why last segment first: "juan/" or "feat/" prefixes come before the ticket.
  for (const segment of branchName(branch).split('/').toReversed()) {
    const key = findTaskKey(segment)
    if (key) {
      return key
    }
  }
  return null
}

/** Linked Jira item first, then the branch, then the display name; null when none carries a key. */
export function getTaskKey(source: TaskKeySource): string | null {
  return (
    getLinkedJiraKey(source.linkedWorkItem) ??
    (source.branch ? getBranchTaskKey(source.branch) : null) ??
    findTaskKey(source.displayName)
  )
}

/** The linked Jira title, only when that item is the one carrying `taskKey`. */
export function getTaskTitle(source: TaskKeySource, taskKey: string): string | null {
  const title = source.linkedWorkItem?.title?.trim()
  return title && getLinkedJiraKey(source.linkedWorkItem) === taskKey ? title : null
}

export function getWorktreeTaskKeySource(
  worktree: Pick<Worktree, 'linkedWorkItem' | 'branch' | 'displayName'>
): TaskKeySource {
  return {
    linkedWorkItem: worktree.linkedWorkItem,
    branch: worktree.branch,
    displayName: worktree.displayName
  }
}

export function getFolderWorkspaceTaskKeySource(
  folderWorkspace: Pick<FolderWorkspace, 'linkedTask' | 'name'>
): TaskKeySource {
  return { linkedWorkItem: folderWorkspace.linkedTask, displayName: folderWorkspace.name }
}

export function getTaskLaneKey(taskKey: string | null): string {
  return taskKey ? `${TASK_LANE_PREFIX}${taskKey}` : NO_TASK_LANE_KEY
}

/** Inverse of getTaskLaneKey; null for "No task" and for keys from other modes. */
export function getTaskKeyFromLaneKey(laneKey: string): string | null {
  if (!laneKey.startsWith(TASK_LANE_PREFIX) || laneKey === NO_TASK_LANE_KEY) {
    return null
  }
  return laneKey.slice(TASK_LANE_PREFIX.length)
}

export function getWorktreeTaskLaneKey(
  worktree: Pick<Worktree, 'linkedWorkItem' | 'branch' | 'displayName'>
): string {
  return getTaskLaneKey(getTaskKey(getWorktreeTaskKeySource(worktree)))
}

export function getFolderWorkspaceTaskLaneKey(
  folderWorkspace: Pick<FolderWorkspace, 'linkedTask' | 'name'>
): string {
  return getTaskLaneKey(getTaskKey(getFolderWorkspaceTaskKeySource(folderWorkspace)))
}
