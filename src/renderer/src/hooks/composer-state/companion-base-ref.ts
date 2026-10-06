import type { Repo } from '../../../../shared/repo-types'

/** A companion that could not use the primary's base and was created from its own default. */
export type CompanionBaseFallback = {
  /** The primary's base this companion was asked to branch from. */
  requested: string
  /** `missing`: the repo has no such ref; `unchecked`: the lookup itself could not run. */
  reason: 'missing' | 'unchecked'
}

export type CompanionBaseDecision = {
  /** Undefined lets the repo use its own default base. */
  baseBranch: string | undefined
  fallback?: CompanionBaseFallback
}

/**
 * The primary's effective Create From value: the explicit selection, otherwise the default its
 * picker shows (the configured base, then the detected one). Undefined when none is known.
 */
export async function resolvePrimaryBaseRef(args: {
  explicitBaseBranch: string | undefined
  primaryRepo: Repo
  resolveDefaultBaseRef: (repo: Repo) => Promise<string | null>
}): Promise<string | undefined> {
  const explicit = args.explicitBaseBranch?.trim()
  if (explicit) {
    return explicit
  }
  const configured = args.primaryRepo.worktreeBaseRef?.trim()
  if (configured) {
    return configured
  }
  try {
    return (await args.resolveDefaultBaseRef(args.primaryRepo))?.trim() || undefined
  } catch {
    // Why: with no known primary base each companion keeps its own default, as before.
    return undefined
  }
}

/** The short name a base-ref search reports: `refs/heads/x` is `x`, `refs/remotes/o/x` is `o/x`. */
export function toSearchableBaseRef(ref: string): string {
  return ref.trim().replace(/^refs\/(?:heads|remotes)\//, '')
}

/** Whether a base-ref search returned exactly `baseRef`; the search also returns near matches. */
export function baseRefSearchFound(refNames: readonly string[], baseRef: string): boolean {
  const wanted = toSearchableBaseRef(baseRef)
  return refNames.some((refName) => toSearchableBaseRef(refName) === wanted)
}

/** The primary's base when this companion has it; otherwise its own default, with the reason. */
export async function resolveCompanionBaseBranch(
  repo: Repo,
  primaryBaseRef: string | undefined,
  hasBaseRef: (repo: Repo, baseRef: string) => Promise<boolean>
): Promise<CompanionBaseDecision> {
  if (!primaryBaseRef) {
    return { baseBranch: undefined }
  }
  let found: boolean
  try {
    found = await hasBaseRef(repo, primaryBaseRef)
  } catch {
    // Why: a lookup that cannot run must not fail the companion, only move it to its default.
    return { baseBranch: undefined, fallback: { requested: primaryBaseRef, reason: 'unchecked' } }
  }
  return found
    ? { baseBranch: primaryBaseRef }
    : { baseBranch: undefined, fallback: { requested: primaryBaseRef, reason: 'missing' } }
}
