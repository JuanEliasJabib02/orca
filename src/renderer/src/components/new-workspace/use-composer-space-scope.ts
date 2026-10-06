import { useMemo } from 'react'
import { useAppStore } from '@/store'
import {
  resolveActiveSidebarSpaceId,
  resolveSidebarSpaceScope,
  type SidebarSpaceScope
} from '@/components/sidebar/sidebar-space-scope'

/** The space the switcher shows as active, resolved the way the sidebar narrows; null = no spaces. */
export function useComposerSpaceScope(): SidebarSpaceScope | null {
  const activeGroupId = useAppStore((s) => s.activeSidebarSpaceGroupId)
  const projectGroups = useAppStore((s) => s.projectGroups)
  const repos = useAppStore((s) => s.repos)
  const folderWorkspaces = useAppStore((s) => s.folderWorkspaces)
  return useMemo(() => {
    // Why the fallbacks: composer tests mock the store with partial state.
    const groups = projectGroups ?? []
    return resolveSidebarSpaceScope({
      // Why the resolver: an unset id still means the first space once spaces exist (no All view).
      activeGroupId: resolveActiveSidebarSpaceId(activeGroupId ?? null, groups),
      projectGroups: groups,
      repos: repos ?? [],
      folderWorkspaces: folderWorkspaces ?? []
    })
  }, [activeGroupId, folderWorkspaces, projectGroups, repos])
}
