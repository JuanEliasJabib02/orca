import { getRepoExecutionHostId } from '../../../../shared/execution-host'
import type { Repo } from '../../../../shared/repo-types'
import { useAppStore } from '@/store'
import { getProjectGroupHostId } from '@/store/slices/project-group-owner-routing'
import { resolveActiveSidebarSpaceId } from './sidebar-space-scope'

/** Files a just-added project into the active space; a spaceless one would show in every space. */
export function fileNewRepoIntoActiveSidebarSpace(repo: Repo): void {
  const state = useAppStore.getState()
  // Why the fallback: Add Project tests mock the store with partial state.
  const projectGroups = state.projectGroups ?? []
  const spaceId = resolveActiveSidebarSpaceId(state.activeSidebarSpaceGroupId, projectGroups)
  const space = projectGroups.find((group) => group.id === spaceId)
  // Why the host check: a group and its projects live on one host, so a remote add stays spaceless.
  if (
    !space ||
    repo.projectGroupId ||
    getProjectGroupHostId(space) !== getRepoExecutionHostId(repo)
  ) {
    return
  }
  void state.moveProjectToGroup(repo.id, space.id)
}
