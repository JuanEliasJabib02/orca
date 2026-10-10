import { describe, expect, it } from 'vitest'
import type { Repo } from '../../../../shared/repo-types'
import { listComposerCompanionCandidates } from './composer-companion-repos'

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
