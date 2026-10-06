import { useEffect } from 'react'
import { useAppStore } from '@/store'
import { resolveActiveSidebarSpaceId } from './sidebar-space-scope'

// Why: there is no All view, so once spaces exist an unset, deleted or nested id settles on a real space.
export function useSidebarActiveSpaceNormalization(): void {
  const persistedUIReady = useAppStore((s) => s.persistedUIReady)
  const projectGroups = useAppStore((s) => s.projectGroups)
  const activeGroupId = useAppStore((s) => s.activeSidebarSpaceGroupId)
  const setActiveGroupId = useAppStore((s) => s.setActiveSidebarSpaceGroupId)

  useEffect(() => {
    // Why wait for hydration: settling earlier would overwrite the persisted space with the first one.
    if (!persistedUIReady) {
      return
    }
    const resolvedId = resolveActiveSidebarSpaceId(activeGroupId, projectGroups)
    if (resolvedId !== null && resolvedId !== activeGroupId) {
      setActiveGroupId(resolvedId)
    }
  }, [activeGroupId, persistedUIReady, projectGroups, setActiveGroupId])
}
