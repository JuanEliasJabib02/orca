import { useMemo } from 'react'
import { useAppStore } from '@/store'
import { getAgentStatusEpochNow } from '@/lib/agent-status-epoch-clock'
import {
  getLiveAgentStatusByWorktreeId,
  type LiveAgentWorktreeStatus
} from '@/lib/worktree-activity-state'
import { folderWorkspaceKey } from '../../../../../../shared/workspace-scope'
import { getVisibleWorktreeTerminalActivityTabs } from '../../visible-worktree-activity-inputs'
import type { TaskSectionInfo } from '../grouping/row-types'

const STATUS_URGENCY: Record<LiveAgentWorktreeStatus, number> = {
  permission: 3,
  working: 2,
  monitoring: 1
}

/** Ids the agent-status store keys a task's members by; folder workspaces use their workspace key. */
export function getTaskSectionStatusIds(task: TaskSectionInfo): string[] {
  return [
    ...task.worktrees.map((worktree) => worktree.worktreeId),
    ...task.folderWorkspaceIds.map((id) => folderWorkspaceKey(id))
  ]
}

/** The most urgent live agent state among `ids`: permission beats working beats monitoring. */
export function rollUpTaskAgentStatus(
  ids: Iterable<string>,
  statusByWorktreeId: ReadonlyMap<string, LiveAgentWorktreeStatus>
): LiveAgentWorktreeStatus | null {
  let rolledUp: LiveAgentWorktreeStatus | null = null
  for (const id of ids) {
    const status = statusByWorktreeId.get(id)
    if (status && (!rolledUp || STATUS_URGENCY[status] > STATUS_URGENCY[rolledUp])) {
      rolledUp = status
    }
  }
  return rolledUp
}

export function useTaskSectionAgentStatus(task: TaskSectionInfo): LiveAgentWorktreeStatus | null {
  // Why the projection: it keeps one identity until a tab id is added or removed, so title churn is quiet.
  const tabsByWorktree = useAppStore((s) =>
    getVisibleWorktreeTerminalActivityTabs(s.tabsByWorktree)
  )
  const agentStatusEpoch = useAppStore((s) => s.agentStatusEpoch)
  const agentStatusNow = getAgentStatusEpochNow(agentStatusEpoch)
  return useMemo(() => {
    // Why the epoch, not agentStatusByPaneKey: the map changes on every hook ping, the epoch only
    // when a status or its freshness changes.
    void agentStatusEpoch
    return rollUpTaskAgentStatus(
      getTaskSectionStatusIds(task),
      getLiveAgentStatusByWorktreeId(
        useAppStore.getState().agentStatusByPaneKey,
        tabsByWorktree,
        agentStatusNow
      )
    )
  }, [agentStatusEpoch, agentStatusNow, tabsByWorktree, task])
}
