import { useAppStore } from '@/store'
import type { ComposerCreateHandoff } from '@/lib/composer-create-handoff'
import type { WorktreeCreationRequest } from '@/lib/workspace/creation/pending-worktree-creation'
import { launchPrimaryWorktree, watchPrimaryFailureForCompanions } from './primary-worktree-launch'

type PrimaryWorktreeLaunchArgs = Parameters<typeof launchPrimaryWorktree>[0]

/** The pending row `handoff.start` filed this request under; start() does not return its id. */
function findPendingCreationIdForRequest(request: WorktreeCreationRequest): string | null {
  const entries = Object.entries(useAppStore.getState().pendingWorktreeCreations)
  return entries.find(([, entry]) => entry.request === request)?.[0] ?? null
}

/**
 * `launchPrimaryWorktree` through the composer's create handoff: a staged sidebar row continues as
 * the primary, and a composer the handoff already closed is not closed or reset again.
 */
export function launchPrimaryWorktreeWithHandoff(
  args: PrimaryWorktreeLaunchArgs & { handoff?: ComposerCreateHandoff }
): void {
  const { handoff, ...launch } = args
  if (!handoff) {
    launchPrimaryWorktree(launch)
    return
  }
  const dismissed = launch.isCancelled()
  // Once a companion exists the submit is committed, so a dismissal still launches the primary.
  if (dismissed && launch.createdCompanions.length === 0) {
    return
  }
  launch.clearDraft?.()
  handoff.start(launch.request)
  if (launch.createdCompanions.length > 0) {
    const creationId = findPendingCreationIdForRequest(launch.request)
    if (creationId) {
      watchPrimaryFailureForCompanions(creationId, launch.createdCompanions)
    }
  }
  if (!dismissed && !handoff.isHandedOff()) {
    launch.afterLaunch?.()
  }
}
