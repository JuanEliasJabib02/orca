import { getRepoExecutionHostId, LOCAL_EXECUTION_HOST_ID } from '../../../../shared/execution-host'
import { isGitRepoKind } from '../../../../shared/repo-kind'
import type { Repo } from '../../../../shared/repo-types'
import type { AppState } from '@/store/types'
import { fileNewRepoIntoActiveSidebarSpace } from './sidebar-space-new-project'

type NewProjectDefaultsState = Parameters<typeof fileNewRepoIntoActiveSidebarSpace>[1] &
  Pick<AppState, 'updateRepo'>

/** Spotlight testing only works on local git repos; main drops the flag for folder or SSH ones. */
function canDefaultSpotlightOn(repo: Repo): boolean {
  return (
    isGitRepoKind(repo) &&
    !repo.connectionId?.trim() &&
    getRepoExecutionHostId(repo) === LOCAL_EXECUTION_HOST_ID
  )
}

/** Orca Pro Max defaults for a just-added project: file it into the active space, turn Spotlight on. */
export async function applyNewProjectDefaults(
  repo: Repo,
  state: NewProjectDefaultsState
): Promise<void> {
  try {
    // Why sequential: both writes return the whole repo row, so overlapping them could restore a stale copy.
    await fileNewRepoIntoActiveSidebarSpace(repo, state)
    if (canDefaultSpotlightOn(repo) && repo.spotlightTestingEnabled !== true) {
      await state.updateRepo(repo.id, { spotlightTestingEnabled: true })
    }
  } catch (err) {
    console.error('Failed to apply new project defaults:', err)
  }
}
