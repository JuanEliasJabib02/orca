import { useEffect, useMemo, useState } from 'react'
import { useAppStore } from '@/store'
import { getIndexedAllWorktrees } from '@/store/worktree-repo-index'
import { getSpotlightVariantForTaskRepo } from '@/store/slices/ui/ui-slice-spotlight-variant-actions'
import { getSpotlightEnvKey } from '@/lib/spotlight-env-key'
import type { Worktree } from '../../../../shared/worktree/types'

const NO_VARIANTS: readonly string[] = []
const NO_WORKTREES: readonly Worktree[] = []

type DetectedVariants = { repoId: string; variants: readonly string[] }

/** The repo's variants while `enabled`; empty while unknown, on failure, or when it has none. */
export function useSpotlightRepoVariants(repoId: string, enabled: boolean): readonly string[] {
  const [detected, setDetected] = useState<DetectedVariants | null>(null)
  useEffect(() => {
    if (!enabled) {
      return
    }
    let cancelled = false
    const settle = (variants: readonly string[]): void => {
      if (!cancelled) {
        setDetected({ repoId, variants })
      }
    }
    void (async () => {
      try {
        const detection = await window.api.repos.detectSpotlightServerScripts({ repoId })
        settle(detection.variants ?? NO_VARIANTS)
      } catch {
        settle(NO_VARIANTS)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [repoId, enabled])
  return enabled && detected?.repoId === repoId ? detected.variants : NO_VARIANTS
}

export type SpotlightHolderVariant = {
  /** Empty unless the row holds the Spotlight and the repo has variants. */
  variants: readonly string[]
  /** The task's variant for this repo, when it is one of `variants`. */
  variant: string | null
}

/** Variant state of the row holding the repo's Spotlight; other rows read nothing. */
export function useSpotlightHolderVariant(
  repoId: string,
  worktree: Worktree,
  held: boolean
): SpotlightHolderVariant {
  const variants = useSpotlightRepoVariants(repoId, held)
  const active = held && variants.length > 0
  // Why the indexed snapshot: it keeps one array per worktreesByRepo, so the memo below holds.
  const allWorktrees = useAppStore((s) =>
    active ? getIndexedAllWorktrees(s.worktreesByRepo) : NO_WORKTREES
  )
  const envKey = useMemo(
    () => (active ? getSpotlightEnvKey(worktree, allWorktrees) : null),
    [active, worktree, allWorktrees]
  )
  const variant = useAppStore((s) =>
    envKey === null
      ? null
      : getSpotlightVariantForTaskRepo(s.spotlightVariantByTaskRepo, envKey, repoId)
  )
  return useMemo(
    () => ({
      variants: active ? variants : NO_VARIANTS,
      variant: active && variant !== null && variants.includes(variant) ? variant : null
    }),
    [active, variants, variant]
  )
}
