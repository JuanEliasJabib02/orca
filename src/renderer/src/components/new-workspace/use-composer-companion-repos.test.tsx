// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Repo } from '../../../../shared/repo-types'

vi.mock('./use-composer-space-scope', () => ({ useComposerSpaceScope: () => null }))

import { useComposerCompanionRepos } from './use-composer-companion-repos'

function repo(id: string): Repo {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: candidate filtering reads only id, kind and host fields.
  return { id, path: `/work/${id}`, displayName: id, badgeColor: '#111', addedAt: 0 } as Repo
}

const repos = [repo('experience'), repo('backend'), repo('admin')]

describe('useComposerCompanionRepos', () => {
  it('starts with nothing picked and toggles chips in row order', () => {
    const { result } = renderHook(() =>
      useComposerCompanionRepos({
        primaryRepoId: 'experience',
        eligibleRepos: repos,
        enabled: true
      })
    )
    expect(result.current.selectedIds).toEqual([])

    act(() => result.current.toggle('admin'))
    act(() => result.current.toggle('backend'))
    expect(result.current.selectedIds).toEqual(['backend', 'admin'])

    act(() => result.current.toggle('admin'))
    expect(result.current.selectedIds).toEqual(['backend'])
  })

  it('clears the picks when the primary changes', () => {
    const { result, rerender } = renderHook(
      ({ primaryRepoId }) =>
        useComposerCompanionRepos({ primaryRepoId, eligibleRepos: repos, enabled: true }),
      { initialProps: { primaryRepoId: 'experience' } }
    )
    act(() => result.current.toggle('admin'))

    rerender({ primaryRepoId: 'backend' })
    expect(result.current.selectedIds).toEqual([])

    rerender({ primaryRepoId: 'experience' })
    expect(result.current.selectedIds).toEqual([])
  })
})
