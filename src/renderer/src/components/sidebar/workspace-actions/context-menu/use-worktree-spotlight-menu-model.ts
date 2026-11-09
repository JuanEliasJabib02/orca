import { useCallback } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useAppStore } from '@/store'
import type { Repo } from '../../../../../../shared/repo-types'
import type { Worktree } from '../../../../../../shared/worktree/types'
import { isFolderRepo } from '../../../../../../shared/repo-kind'
import { canHoldSpotlight } from '../../WorktreeCardSpotlightControls'

/** The Spotlight state and actions a single workspace's context menu offers (Orca Pro Max). */
export function useWorktreeSpotlightMenuModel(worktree: Worktree, repo: Repo | null | undefined) {
  // Why useShallow + a narrow view: main replaces this repo's spotlight object
  // on every sync. A raw-object selector would re-run this per-row menu on each
  // sync; selecting only the flags this menu reads keeps it stable.
  const spotlight = useAppStore(
    useShallow((s) => {
      const st = repo ? s.spotlightByRepo?.[repo.id] : undefined
      return {
        active: Boolean(st),
        holderWorktreeId: st?.holderWorktreeId ?? null,
        syncing: st?.status === 'syncing',
        rootDiverged: st?.lastError?.code === 'root-diverged'
      }
    })
  )
  const spotlightEligible = repo ? canHoldSpotlight(worktree, repo, isFolderRepo(repo)) : false
  const spotlightHeldHere = spotlight.holderWorktreeId === worktree.id
  // The main worktree can't hold the Spotlight, but while it's on its context
  // menu offers the off switch (the root is what Spotlight is rewriting).
  const spotlightOffOnMain = Boolean(worktree.isMainWorktree && repo && spotlight.active)
  const handleToggleSpotlight = useCallback(() => {
    if (!repo) {
      return
    }
    const state = useAppStore.getState()
    if (
      worktree.isMainWorktree ||
      state.spotlightByRepo[repo.id]?.holderWorktreeId === worktree.id
    ) {
      void state.deactivateSpotlight(repo.id)
      return
    }
    // activateSpotlight already opens/adopts the repo's server terminal on
    // success — don't open it again here.
    void state.activateSpotlight(repo.id, worktree.id)
  }, [repo, worktree.id, worktree.isMainWorktree])
  const handleForceSyncSpotlight = useCallback(() => {
    if (repo) {
      void useAppStore.getState().forceSyncSpotlight(repo.id)
    }
  }, [repo])

  return {
    spotlight,
    spotlightEligible,
    spotlightHeldHere,
    spotlightOffOnMain,
    handleToggleSpotlight,
    handleForceSyncSpotlight
  }
}
