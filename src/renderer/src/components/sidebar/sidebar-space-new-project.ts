import { getRepoExecutionHostId } from '../../../../shared/execution-host'
import type { Repo } from '../../../../shared/repo-types'
import { getProjectGroupHostId } from '@/store/slices/project-group-owner-routing'
import type { AppState } from '@/store/types'
import { resolveActiveSidebarSpaceId } from './sidebar-space-scope'

type SpaceFilingState = Pick<
  AppState,
  'projectGroups' | 'activeSidebarSpaceGroupId' | 'moveProjectToGroup'
>

/**
 * Files a just-added project into the active space; a spaceless one would show in every space.
 * Takes the state instead of reading the store so the repo slice can call it without a cycle.
 */
export async function fileNewRepoIntoActiveSidebarSpace(
  repo: Repo,
  state: SpaceFilingState
): Promise<void> {
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
  await state.moveProjectToGroup(repo.id, space.id)
}
