import { useMemo } from 'react'
import { useAppStore } from '@/store'
import type { Repo } from '../../../../shared/repo-types'
import {
  filterReposToSidebarSpace,
  resolveSidebarSpaceScope,
  type SidebarSpaceScope
} from './sidebar-space-scope'

/** `null` means "All": no active space. Memoized so consumers can key their own memos on it. */
export function useActiveSidebarSpaceScope(): SidebarSpaceScope | null {
  const activeGroupId = useAppStore((s) => s.activeSidebarSpaceGroupId)
  const projectGroups = useAppStore((s) => s.projectGroups)
  const repos = useAppStore((s) => s.repos)
  const folderWorkspaces = useAppStore((s) => s.folderWorkspaces)
  return useMemo(
    () =>
      // Why the early return: skips the group walk in the "All" case and in partial test states.
      activeGroupId
        ? resolveSidebarSpaceScope({ activeGroupId, projectGroups, repos, folderWorkspaces })
        : null,
    [activeGroupId, projectGroups, repos, folderWorkspaces]
  )
}

/** The projects the workspace-nav Projects filters list: the active space's, or all without one. */
export function useActiveSpaceRepos(): readonly Repo[] {
  const repos = useAppStore((s) => s.repos)
  const spaceScope = useActiveSidebarSpaceScope()
  return useMemo(() => filterReposToSidebarSpace(repos, spaceScope), [repos, spaceScope])
}
