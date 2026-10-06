import { useCallback, useMemo, useState } from 'react'
import { useAppStore } from '@/store'
import type { Repo } from '../../../../shared/repo-types'
import {
  listComposerCompanionCandidates,
  mergeRememberedCompanionIds,
  selectRememberedCompanionIds
} from './composer-companion-repos'
import { useComposerSpaceScope } from './use-composer-space-scope'

export type ComposerCompanionRepos = {
  candidates: readonly Repo[]
  selectedIds: readonly string[]
  toggle: (repoId: string) => void
  grantAgentAccess: boolean
  setGrantAgentAccess: (next: boolean) => void
}

/**
 * State for the composer's "Also create in" row. The selection lives in the store, remembered per
 * primary repo, so picking a primary prefills the companions it was last created with.
 */
export function useComposerCompanionRepos(args: {
  primaryRepoId: string
  eligibleRepos: readonly Repo[]
  /** False for folder targets and non-git primaries, which have no branch to mirror. */
  enabled: boolean
}): ComposerCompanionRepos {
  const { primaryRepoId, eligibleRepos, enabled } = args
  const scope = useComposerSpaceScope()
  const repos = useAppStore((s) => s.repos)
  const rememberedByRepoId = useAppStore((s) => s.composerCompanionRepoIdsByRepoId)
  const setRememberedCompanionIds = useAppStore((s) => s.setComposerCompanionRepoIds)
  const [grantAgentAccess, setGrantAgentAccess] = useState(true)

  const candidates = useMemo(
    () =>
      enabled
        ? listComposerCompanionCandidates({
            repos: eligibleRepos,
            primaryRepo: eligibleRepos.find((repo) => repo.id === primaryRepoId),
            scope
          })
        : [],
    [eligibleRepos, enabled, primaryRepoId, scope]
  )
  const remembered = rememberedByRepoId?.[primaryRepoId]
  const selectedIds = useMemo(
    () => selectRememberedCompanionIds(remembered, candidates),
    [candidates, remembered]
  )

  const toggle = useCallback(
    (repoId: string): void => {
      const nextSelected = new Set(selectedIds)
      if (nextSelected.has(repoId)) {
        nextSelected.delete(repoId)
      } else {
        nextSelected.add(repoId)
      }
      setRememberedCompanionIds(
        primaryRepoId,
        mergeRememberedCompanionIds({
          remembered,
          candidateIds: new Set(candidates.map((repo) => repo.id)),
          existingRepoIds: new Set((repos ?? []).map((repo) => repo.id)),
          selectedIds: candidates.filter((repo) => nextSelected.has(repo.id)).map((repo) => repo.id)
        })
      )
    },
    [candidates, primaryRepoId, remembered, repos, selectedIds, setRememberedCompanionIds]
  )

  return { candidates, selectedIds, toggle, grantAgentAccess, setGrantAgentAccess }
}
