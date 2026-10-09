import {
  noSpotlightVariantInference,
  type SpotlightVariantInference
} from '../../shared/spotlight-server-variant'
import { SPOTLIGHT_VARIANT_APPS_DIR } from './spotlight-server-variant-detection'

/** Runs git in the worktree; resolves to stdout, rejects when git fails. */
export type SpotlightVariantGit = (args: string[]) => Promise<string>

// Why a cap: a branch that rewrote thousands of files still only needs its first few paths read.
const MAX_CHANGED_PATHS = 20_000
const MAX_BASE_REF_LENGTH = 512
const COMMIT_ID = /^[0-9a-f]{7,64}$/i

/** Variants (in their own order) whose `apps/<V>/` folder holds one of the repo-relative `paths`. */
export function mapChangedPathsToVariants(
  paths: readonly string[],
  variants: readonly string[]
): string[] {
  const variantByFolder = new Map(variants.map((variant) => [variant.toLowerCase(), variant]))
  const prefix = `${SPOTLIGHT_VARIANT_APPS_DIR}/`
  const touched = new Set<string>()
  for (const path of paths) {
    if (!path.startsWith(prefix)) {
      continue
    }
    const rest = path.slice(prefix.length)
    const slash = rest.indexOf('/')
    // A file directly under apps/ belongs to no app.
    if (slash <= 0) {
      continue
    }
    const variant = variantByFolder.get(rest.slice(0, slash).toLowerCase())
    if (variant) {
      touched.add(variant)
    }
  }
  return variants.filter((variant) => touched.has(variant))
}

// Why: refs come from persisted metadata, and one starting with `-` would read as a git option.
function isUsableBaseRef(ref: string | null | undefined): ref is string {
  return (
    typeof ref === 'string' &&
    ref.length > 0 &&
    ref.length <= MAX_BASE_REF_LENGTH &&
    !ref.startsWith('-') &&
    !/\s/.test(ref)
  )
}

async function mergeBaseWith(git: SpotlightVariantGit, ref: string): Promise<string | null> {
  try {
    const sha = (await git(['merge-base', ref, 'HEAD'])).trim()
    return COMMIT_ID.test(sha) ? sha : null
  } catch {
    return null
  }
}

/** HEAD's merge-base with the first base that has one; the default base is resolved only if needed. */
async function findMergeBase(
  git: SpotlightVariantGit,
  baseRefs: readonly (string | null | undefined)[],
  resolveDefaultBaseRef: () => Promise<string | null>
): Promise<string | null> {
  for (const ref of baseRefs) {
    if (isUsableBaseRef(ref)) {
      const sha = await mergeBaseWith(git, ref)
      if (sha) {
        return sha
      }
    }
  }
  const fallback = await resolveDefaultBaseRef().catch(() => null)
  return isUsableBaseRef(fallback) ? mergeBaseWith(git, fallback) : null
}

/**
 * Which variant a worktree's branch works on: the `apps/<V>/` folders it changed since it left its
 * base. Exactly one is inferred; several (or none) stay ambiguous with the ones it touched. Never
 * throws: any git failure is ambiguous with no candidates.
 */
export async function inferSpotlightVariant(args: {
  git: SpotlightVariantGit
  variants: readonly string[]
  /** Bases to try in order (worktree's own base, the repo's setting). */
  baseRefs: readonly (string | null | undefined)[]
  resolveDefaultBaseRef: () => Promise<string | null>
}): Promise<SpotlightVariantInference> {
  const { git, variants } = args
  if (variants.length === 0) {
    return noSpotlightVariantInference()
  }
  const mergeBase = await findMergeBase(git, args.baseRefs, args.resolveDefaultBaseRef)
  if (!mergeBase) {
    return noSpotlightVariantInference()
  }
  let output: string
  try {
    // Why the working tree, not `...HEAD`: Spotlight mirrors uncommitted edits too, and a new
    // branch often has nothing else yet. The pathspec keeps the output to apps/ only.
    output = await git([
      'diff',
      '--name-only',
      '--no-renames',
      '-z',
      mergeBase,
      '--',
      `${SPOTLIGHT_VARIANT_APPS_DIR}/`
    ])
  } catch {
    return noSpotlightVariantInference()
  }
  const paths = output.split('\0').filter(Boolean).slice(0, MAX_CHANGED_PATHS)
  const touched = mapChangedPathsToVariants(paths, variants)
  return touched.length === 1
    ? { kind: 'inferred', variant: touched[0] }
    : { kind: 'ambiguous', candidates: touched }
}
