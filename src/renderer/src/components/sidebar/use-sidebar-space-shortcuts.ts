import { useEffect } from 'react'
import { useAppStore } from '@/store'
import { listSidebarSpaces } from './sidebar-space-scope'

/** Activates the space at `index` in switcher order; out of range or already active is a no-op. */
export function selectSidebarSpaceByIndex(index: number): void {
  const { projectGroups, activeSidebarSpaceGroupId, setActiveSidebarSpaceGroupId } =
    useAppStore.getState()
  const space = listSidebarSpaces(projectGroups)[index]
  if (space && space.id !== activeSidebarSpaceGroupId) {
    setActiveSidebarSpaceGroupId(space.id)
  }
}

// Why: mounted at app level (not in the switcher) so the keys work while the sidebar is collapsed.
export function useSidebarSpaceShortcuts(): void {
  useEffect(() => window.api.ui.onSelectSidebarSpace(selectSidebarSpaceByIndex), [])
}
