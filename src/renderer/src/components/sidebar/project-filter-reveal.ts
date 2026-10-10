import type { AppState } from '@/store/types'
import {
  findSidebarSpaceToReveal,
  getSpaceRepoFilterIds,
  resolveSidebarSpaceScope,
  resolveSidebarSpaceScopeFromState,
  type SidebarSpaceScope
} from './sidebar-space-scope'

export type ProjectFilterRevealState = Pick<
  AppState,
  'activeSidebarSpaceGroupId' | 'projectGroups' | 'repos' | 'folderWorkspaces'
> & {
  filterRepoIds: readonly string[]
  setFilterRepoIds: (repoIds: readonly string[]) => void
}

type SpaceSources = Pick<
  AppState,
  'activeSidebarSpaceGroupId' | 'projectGroups' | 'repos' | 'folderWorkspaces'
>

function toSpaceSources(state: SpaceSources) {
  return {
    activeGroupId: state.activeSidebarSpaceGroupId,
    projectGroups: state.projectGroups,
    repos: state.repos,
    folderWorkspaces: state.folderWorkspaces
  }
}

// Why: the sidebar reveal switches to the repo's space when the active one doesn't show it, so
// that space decides. A repo id is no workspace key, so the lookup takes the repo branch.
function findSpaceRevealingRepo(state: SpaceSources, repoId: string): string | null {
  return findSidebarSpaceToReveal({ id: repoId, repoId }, toSpaceSources(state))
}

function resolveSpaceShowingRepo(
  state: ProjectFilterRevealState,
  repoId: string
): SidebarSpaceScope | null {
  const spaceId = findSpaceRevealingRepo(state, repoId)
  return spaceId
    ? resolveSidebarSpaceScope({ ...toSpaceSources(state), activeGroupId: spaceId })
    : resolveSidebarSpaceScopeFromState(state)
}

/** The Group by the repo's row renders under once revealed: its space's remembered one on a switch. */
export function resolveGroupByShowingRepo(
  state: SpaceSources & Pick<AppState, 'groupBy' | 'groupByBySpaceId'>,
  repoId: string
): AppState['groupBy'] {
  const spaceId = findSpaceRevealingRepo(state, repoId)
  return (spaceId ? state.groupByBySpaceId[spaceId] : undefined) ?? state.groupBy
}

export function revealRepoInProjectFilter(state: ProjectFilterRevealState, repoId: string): void {
  const idsInSpace = getSpaceRepoFilterIds(
    state.filterRepoIds,
    resolveSpaceShowingRepo(state, repoId)
  )
  // Why: an empty allow-list disables filtering, so adding one id would narrow the unfiltered view;
  // the list is global, so picks made in another space must not count as this space's filter.
  if (idsInSpace.length === 0 || idsInSpace.includes(repoId)) {
    return
  }
  state.setFilterRepoIds([...state.filterRepoIds, repoId])
}
