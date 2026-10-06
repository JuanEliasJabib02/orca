import { toast } from 'sonner'
import { useAppStore } from '@/store'
import type { AppState } from '@/store/types'
import { translate } from '@/i18n/i18n'
import type { WorktreeCreationRequest } from '@/lib/pending-worktree-creation'
import { runBackgroundWorktreeCreation } from '@/lib/worktree-creation-flow'
import type { CreatedCompanionWorktree } from './multi-repo-worktree-creation'

function toastCompanionsLeft(companions: readonly CreatedCompanionWorktree[]): void {
  toast.error(
    translate(
      'auto.hooks.useComposerState.companionsLeftTitle',
      'The main worktree failed after its companions were created'
    ),
    {
      description: translate(
        'auto.hooks.useComposerState.companionsLeftDescription',
        'These companion worktrees still exist: {{companions}}. Remove them if you no longer need them.',
        {
          companions: companions
            .map((companion) => `${companion.repoName} (${companion.branch})`)
            .join(', ')
        }
      )
    }
  )
}

/** Once the primary's background create errors, one toast names the companions it left behind. */
export function watchPrimaryFailureForCompanions(
  creationId: string,
  companions: readonly CreatedCompanionWorktree[]
): void {
  if (companions.length === 0) {
    return
  }
  // True once there is nothing left to watch: the create errored, finished, or was dismissed.
  const settle = (state: Pick<AppState, 'pendingWorktreeCreations'>): boolean => {
    const entry = state.pendingWorktreeCreations[creationId]
    if (entry?.status === 'error') {
      toastCompanionsLeft(companions)
      return true
    }
    return !entry
  }
  if (settle(useAppStore.getState())) {
    return
  }
  const unsubscribe = useAppStore.subscribe((state) => {
    if (settle(state)) {
      unsubscribe()
    }
  })
}

/**
 * Starts the primary's background create. Once a companion exists the submit is committed: a late
 * dismissal only closed the dialog, so the primary still runs and completes the set.
 */
export function launchPrimaryWorktree(args: {
  request: WorktreeCreationRequest
  createdCompanions: readonly CreatedCompanionWorktree[]
  isCancelled: () => boolean
  clearDraft?: () => void
  /** Closes or resets the composer; skipped after a dismissal, which already closed it. */
  afterLaunch?: () => void
}): void {
  const dismissed = args.isCancelled()
  if (dismissed && args.createdCompanions.length === 0) {
    return
  }
  args.clearDraft?.()
  const creationId = runBackgroundWorktreeCreation(args.request)
  watchPrimaryFailureForCompanions(creationId, args.createdCompanions)
  if (!dismissed) {
    args.afterLaunch?.()
  }
}
