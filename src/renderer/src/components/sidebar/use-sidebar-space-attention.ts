import { useMemo } from 'react'
import { useAppStore } from '@/store'
import { getAgentStatusEpochNow } from '@/lib/agent-status-epoch-clock'
import { getLiveAgentStatusByWorktreeId } from '@/lib/worktree-activity-state'
import { getVisibleWorktreeTerminalActivityTabs } from './visible-worktree-activity-inputs'
import { rollUpSidebarSpaceAttention, type SidebarSpaceAttention } from './sidebar-space-attention'

export function useSidebarSpaceAttention(): ReadonlyMap<string, SidebarSpaceAttention> {
  const projectGroups = useAppStore((s) => s.projectGroups)
  const repos = useAppStore((s) => s.repos)
  const folderWorkspaces = useAppStore((s) => s.folderWorkspaces)
  const worktreesByRepo = useAppStore((s) => s.worktreesByRepo)
  // Why the projection: it keeps one identity until a tab id is added or removed, so title churn is quiet.
  const tabsByWorktree = useAppStore((s) =>
    getVisibleWorktreeTerminalActivityTabs(s.tabsByWorktree)
  )
  const unreadTerminalTabs = useAppStore((s) => s.unreadTerminalTabs)
  const agentStatusEpoch = useAppStore((s) => s.agentStatusEpoch)
  const agentStatusNow = getAgentStatusEpochNow(agentStatusEpoch)

  return useMemo(() => {
    // Why the epoch, not agentStatusByPaneKey: the map changes on every hook ping, the epoch only on
    // a status change or a freshness boundary, which are the only moments a dot can flip.
    void agentStatusEpoch
    return rollUpSidebarSpaceAttention({
      projectGroups,
      repos,
      folderWorkspaces,
      worktreesByRepo,
      tabsByWorktree,
      unreadTerminalTabs,
      liveAgentStatusByWorktreeId: getLiveAgentStatusByWorktreeId(
        useAppStore.getState().agentStatusByPaneKey,
        tabsByWorktree,
        agentStatusNow
      )
    })
  }, [
    agentStatusEpoch,
    agentStatusNow,
    projectGroups,
    repos,
    folderWorkspaces,
    worktreesByRepo,
    tabsByWorktree,
    unreadTerminalTabs
  ])
}
