import { useMemo } from 'react'
import type { FolderWorkspace } from '../../../../../../shared/folder-workspace-types'
import type { ProjectGroup } from '../../../../../../shared/project-group-types'
import type { Repo } from '../../../../../../shared/repo-types'
import {
  getRepoExecutionHostId,
  type ExecutionHostId
} from '../../../../../../shared/execution-host'
import type { SidebarWorktreeFilters } from './use-filters'
import { filterFolderWorkspacesFromOtherDevices } from '../../workspace-creator-visibility'
import {
  filterFolderWorkspacesToSidebarSpace,
  filterProjectGroupsToSidebarSpace
} from '../../sidebar-space-scope'
import {
  filterFolderWorkspacesForVisibleHosts,
  filterProjectGroupsForVisibleHosts,
  getVisibleSidebarHostIdSet
} from './host-filtering'

// Narrows repos, project groups, and folder workspaces to the hosts (and devices) the
// current host filter admits, then to the active sidebar space.
export function useSidebarHostVisibleScope(args: {
  filterState: SidebarWorktreeFilters['filterState']
  defaultHostId: ExecutionHostId
  repos: readonly Repo[]
  projectGroups: readonly ProjectGroup[]
  folderWorkspaces: readonly FolderWorkspace[]
  pairedDeviceIdsByEnvironment: Parameters<typeof filterFolderWorkspacesFromOtherDevices>[1]
}) {
  const { filterState, defaultHostId, repos, projectGroups, folderWorkspaces } = args
  const {
    visibleWorkspaceHostIds,
    workspaceHostScope,
    hideWorkspacesFromOtherDevices,
    spaceScope
  } = filterState
  const visibleHostIdSet = useMemo(
    () => getVisibleSidebarHostIdSet(visibleWorkspaceHostIds, workspaceHostScope),
    [visibleWorkspaceHostIds, workspaceHostScope]
  )
  const visibleReposForRows = useMemo(() => {
    if (!visibleHostIdSet && !spaceScope) {
      return repos
    }
    return repos.filter((repo) => {
      if (spaceScope && !spaceScope.repoIds.has(repo.id)) {
        return false
      }
      if (!visibleHostIdSet) {
        return true
      }
      const hostId =
        repo.connectionId || repo.executionHostId ? getRepoExecutionHostId(repo) : defaultHostId
      return visibleHostIdSet.has(hostId)
    })
  }, [defaultHostId, repos, spaceScope, visibleHostIdSet])
  const visibleProjectGroupsForRows = useMemo(() => {
    // Why: appendProjectGroupSections renders a header for every group it receives.
    return filterProjectGroupsToSidebarSpace(
      filterProjectGroupsForVisibleHosts(projectGroups, visibleHostIdSet, defaultHostId),
      spaceScope
    )
  }, [defaultHostId, projectGroups, spaceScope, visibleHostIdSet])
  const visibleFolderWorkspacesForRows = useMemo(() => {
    const hostVisibleWorkspaces = filterFolderWorkspacesForVisibleHosts(
      folderWorkspaces,
      projectGroups,
      visibleHostIdSet,
      defaultHostId
    )
    const deviceVisibleWorkspaces = hideWorkspacesFromOtherDevices
      ? filterFolderWorkspacesFromOtherDevices(
          hostVisibleWorkspaces,
          args.pairedDeviceIdsByEnvironment
        )
      : hostVisibleWorkspaces
    return filterFolderWorkspacesToSidebarSpace(deviceVisibleWorkspaces, spaceScope)
  }, [
    args.pairedDeviceIdsByEnvironment,
    defaultHostId,
    folderWorkspaces,
    hideWorkspacesFromOtherDevices,
    projectGroups,
    spaceScope,
    visibleHostIdSet
  ])

  return { visibleReposForRows, visibleProjectGroupsForRows, visibleFolderWorkspacesForRows }
}
