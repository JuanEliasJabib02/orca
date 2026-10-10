import { useCallback, useMemo, useState } from 'react'
import type { Repo } from '../../../../shared/repo-types'
import { listComposerCompanionCandidates } from './composer-companion-repos'
import { useComposerSpaceScope } from './use-composer-space-scope'

export type ComposerCompanionRepos = {
  candidates: readonly Repo[]
  selectedIds: readonly string[]
  toggle: (repoId: string) => void
  grantAgentAccess: boolean
  setGrantAgentAccess: (next: boolean) => void
}

/**
 * State for the composer's "Also create in" row. Every new workspace starts with none picked, and
 * switching the primary clears the picks: a remembered set had to be unpicked one chip at a time.
 */
export function useComposerCompanionRepos(args: {
  primaryRepoId: string
  eligibleRepos: readonly Repo[]
  /** False for folder targets and non-git primaries, which have no branch to mirror. */
  enabled: boolean
}): ComposerCompanionRepos {
  const { primaryRepoId, eligibleRepos, enabled } = args
  const scope = useComposerSpaceScope()
  const [picked, setPicked] = useState<{ primaryRepoId: string; ids: readonly string[] }>({
    primaryRepoId,
    ids: []
  })
  // Why reset rather than hide: switching back to a primary must not revive its old picks.
  if (picked.primaryRepoId !== primaryRepoId) {
    setPicked({ primaryRepoId, ids: [] })
  }
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
  const pickedIds = picked.primaryRepoId === primaryRepoId ? picked.ids : null
  const selectedIds = useMemo(() => {
    const ids = new Set(pickedIds)
    return candidates.filter((repo) => ids.has(repo.id)).map((repo) => repo.id)
  }, [candidates, pickedIds])

  const toggle = useCallback(
    (repoId: string): void => {
      const next = new Set(selectedIds)
      if (next.has(repoId)) {
        next.delete(repoId)
      } else {
        next.add(repoId)
      }
      setPicked({ primaryRepoId, ids: [...next] })
    },
    [primaryRepoId, selectedIds]
  )

  return { candidates, selectedIds, toggle, grantAgentAccess, setGrantAgentAccess }
}
