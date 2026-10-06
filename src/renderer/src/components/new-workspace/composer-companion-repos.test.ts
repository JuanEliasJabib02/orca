import { describe, expect, it } from 'vitest'
import type { Repo } from '../../../../shared/repo-types'
import {
  listComposerCompanionCandidates,
  mergeRememberedCompanionIds,
  selectRememberedCompanionIds
} from './composer-companion-repos'

function repo(id: string, overrides: Partial<Repo> = {}): Repo {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: candidate filtering reads only id, kind and host fields.
  return {
    id,
    path: `/work/${id}`,
    displayName: id,
    badgeColor: '#111',
    addedAt: 0,
    ...overrides
  } as Repo
}

const experience = repo('experience')
const repos = [
  experience,
  repo('backend'),
  repo('admin'),
  repo('blog'),
  repo('notes', { kind: 'folder' }),
  repo('devbox-api', { connectionId: 'devbox' })
]

describe('listComposerCompanionCandidates', () => {
  it('offers git repos on the primary host, never the primary itself', () => {
    expect(
      listComposerCompanionCandidates({
        repos,
        primaryRepo: experience,
        scope: null
      }).map((candidate) => candidate.id)
    ).toEqual(['backend', 'admin', 'blog'])
  })

  it('narrows to the active space', () => {
    const scope = { repoIds: new Set(['experience', 'backend', 'admin']) }
    expect(
      listComposerCompanionCandidates({
        repos,
        primaryRepo: experience,
        scope
      }).map((candidate) => candidate.id)
    ).toEqual(['backend', 'admin'])
  })

  it('offers nothing for a folder primary or no primary', () => {
    expect(listComposerCompanionCandidates({ repos, primaryRepo: repos[4], scope: null })).toEqual(
      []
    )
    expect(listComposerCompanionCandidates({ repos, primaryRepo: undefined, scope: null })).toEqual(
      []
    )
  })
})

describe('selectRememberedCompanionIds', () => {
  it('prefills only remembered repos that are still offered, in row order', () => {
    const candidates = [repo('backend'), repo('admin'), repo('reset')]
    expect(selectRememberedCompanionIds(['reset', 'deleted', 'backend'], candidates)).toEqual([
      'backend',
      'reset'
    ])
    expect(selectRememberedCompanionIds(undefined, candidates)).toEqual([])
  })
})

describe('mergeRememberedCompanionIds', () => {
  it('keeps ids another space hides but drops ids whose repo is gone', () => {
    expect(
      mergeRememberedCompanionIds({
        remembered: ['backend', 'blog', 'deleted'],
        candidateIds: new Set(['backend', 'admin']),
        existingRepoIds: new Set(['backend', 'admin', 'blog']),
        selectedIds: ['admin']
      })
    ).toEqual(['admin', 'blog'])
  })
})
