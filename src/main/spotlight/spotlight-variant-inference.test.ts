import { describe, expect, it, vi, type Mock } from 'vitest'
import {
  inferSpotlightVariant,
  mapChangedPathsToVariants,
  type SpotlightVariantGit
} from './spotlight-variant-inference'

const VARIANTS = ['br', 'do', 'ec', 'es', 'gb', 'pt']
const MERGE_BASE = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2'

/** A git that knows `bases` (ref → merge-base) and answers the diff with `changed` paths. */
function fakeGit(
  changed: string[],
  bases: Record<string, string> = { 'origin/main': MERGE_BASE }
): Mock<SpotlightVariantGit> {
  return vi.fn<SpotlightVariantGit>(async (args) => {
    if (args[0] === 'merge-base') {
      const sha = bases[args[1] ?? '']
      if (!sha) {
        throw new Error(`fatal: Not a valid object name ${args[1]}`)
      }
      return `${sha}\n`
    }
    if (args[0] === 'diff') {
      return changed.map((path) => `${path}\0`).join('')
    }
    throw new Error(`unexpected git ${args.join(' ')}`)
  })
}

function infer(
  git: SpotlightVariantGit,
  overrides: Partial<Parameters<typeof inferSpotlightVariant>[0]> = {}
): ReturnType<typeof inferSpotlightVariant> {
  return inferSpotlightVariant({
    git,
    variants: VARIANTS,
    baseRefs: ['origin/main'],
    resolveDefaultBaseRef: async () => null,
    ...overrides
  })
}

describe('mapChangedPathsToVariants', () => {
  it('maps apps/<V>/** to its variant, ignoring case, in variant order', () => {
    expect(
      mapChangedPathsToVariants(
        ['apps/PT/page.tsx', 'apps/DO/app/layout.tsx', 'apps/do/x.ts', 'shared/ui.tsx'],
        VARIANTS
      )
    ).toEqual(['do', 'pt'])
  })

  it('ignores files directly under apps/, unknown apps and other folders', () => {
    expect(
      mapChangedPathsToVariants(
        ['apps/DO', 'apps/README.md', 'apps/MX/page.tsx', 'x/apps/DO/a'],
        VARIANTS
      )
    ).toEqual([])
  })
})

describe('inferSpotlightVariant', () => {
  it('infers the one app the branch changed', async () => {
    const git = fakeGit(['apps/DO/app/page.tsx', 'apps/DO/next.config.ts', 'shared/ui.tsx'])

    expect(await infer(git)).toEqual({ kind: 'inferred', variant: 'do' })
  })

  it('diffs the merge-base against the working tree, limited to apps/', async () => {
    const git = fakeGit(['apps/DO/app/page.tsx'])

    await infer(git)

    expect(git).toHaveBeenCalledWith(['merge-base', 'origin/main', 'HEAD'])
    expect(git).toHaveBeenCalledWith([
      'diff',
      '--name-only',
      '--no-renames',
      '-z',
      MERGE_BASE,
      '--',
      'apps/'
    ])
  })

  it('is ambiguous with the touched apps when the branch changed several', async () => {
    const git = fakeGit(['apps/PT/a.tsx', 'apps/DO/b.tsx'])

    expect(await infer(git)).toEqual({ kind: 'ambiguous', candidates: ['do', 'pt'] })
  })

  it('is ambiguous with no candidates when the branch changed no app', async () => {
    expect(await infer(fakeGit(['shared/ui.tsx']))).toEqual({ kind: 'ambiguous', candidates: [] })
    expect(await infer(fakeGit([]))).toEqual({ kind: 'ambiguous', candidates: [] })
  })

  it('tries the next base when one has no merge-base, then the default base', async () => {
    const git = fakeGit(['apps/GB/a.tsx'], { main: MERGE_BASE })
    const resolveDefaultBaseRef = vi.fn(async () => 'main')

    const result = await infer(git, {
      baseRefs: ['origin/gone', undefined, null, ''],
      resolveDefaultBaseRef
    })

    expect(result).toEqual({ kind: 'inferred', variant: 'gb' })
    expect(git).toHaveBeenCalledWith(['merge-base', 'origin/gone', 'HEAD'])
    expect(git).toHaveBeenCalledWith(['merge-base', 'main', 'HEAD'])
  })

  it('resolves the default base only when the known ones fail', async () => {
    const resolveDefaultBaseRef = vi.fn(async () => 'main')

    await infer(fakeGit(['apps/DO/a.tsx']), { resolveDefaultBaseRef })

    expect(resolveDefaultBaseRef).not.toHaveBeenCalled()
  })

  it('never passes a base that git would read as an option', async () => {
    const git = fakeGit(['apps/DO/a.tsx'], { '--output=/tmp/x': MERGE_BASE })

    const result = await infer(git, { baseRefs: ['--output=/tmp/x', 'a b'] })

    expect(result).toEqual({ kind: 'ambiguous', candidates: [] })
    expect(git).not.toHaveBeenCalled()
  })

  it('is ambiguous with no candidates when git fails', async () => {
    const git = vi.fn<SpotlightVariantGit>(async (args) => {
      if (args[0] === 'merge-base') {
        return MERGE_BASE
      }
      throw new Error('maxBuffer exceeded')
    })

    expect(await infer(git)).toEqual({ kind: 'ambiguous', candidates: [] })
  })

  it('ignores a merge-base answer that is not a commit id', async () => {
    const git = fakeGit(['apps/DO/a.tsx'], { 'origin/main': 'warning: something' })

    expect(await infer(git)).toEqual({ kind: 'ambiguous', candidates: [] })
  })

  it('reads nothing for a repo without variants', async () => {
    const git = fakeGit(['apps/DO/a.tsx'])

    expect(await infer(git, { variants: [] })).toEqual({ kind: 'ambiguous', candidates: [] })
    expect(git).not.toHaveBeenCalled()
  })

  it('survives a default base lookup that throws', async () => {
    const git = fakeGit(['apps/DO/a.tsx'], {})

    const result = await infer(git, {
      baseRefs: [],
      resolveDefaultBaseRef: async () => {
        throw new Error('git gone')
      }
    })

    expect(result).toEqual({ kind: 'ambiguous', candidates: [] })
  })
})
