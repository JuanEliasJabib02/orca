import { describe, expect, it, vi } from 'vitest'
import type { Repo } from '../../../../shared/repo-types'
import { revealRepoInProjectFilter } from './worktree-list/controls/project-filter-reveal'
import { SPACE_FILTER_REPOS, spaceFilterStoreState } from './sidebar-space-project-filter-fixtures'

function makeState(filterRepoIds: readonly string[], activeSpaceGroupId: string | null = null) {
  return {
    ...spaceFilterStoreState(activeSpaceGroupId),
    filterRepoIds,
    setFilterRepoIds: vi.fn()
  }
}

describe('revealRepoInProjectFilter in a space', () => {
  it('leaves the space unfiltered when the only picks belong to another space', () => {
    const state = makeState(['personal-blog'], 'work')

    revealRepoInProjectFilter(state, 'work-api')

    expect(state.setFilterRepoIds).not.toHaveBeenCalled()
  })

  it('adds the project to this space picks and keeps the other space picks', () => {
    const state = makeState(['personal-blog', 'work-api'], 'work')

    revealRepoInProjectFilter(state, 'work-web')

    expect(state.setFilterRepoIds).toHaveBeenCalledWith(['personal-blog', 'work-api', 'work-web'])
  })

  it('does nothing when the project is already picked in this space', () => {
    const state = makeState(['personal-blog', 'work-api'], 'work')

    revealRepoInProjectFilter(state, 'work-api')

    expect(state.setFilterRepoIds).not.toHaveBeenCalled()
  })

  describe('for a project of another space', () => {
    it('leaves the target space unfiltered when only the active space has picks', () => {
      const state = makeState(['work-api'], 'work')

      revealRepoInProjectFilter(state, 'personal-blog')

      expect(state.setFilterRepoIds).not.toHaveBeenCalled()
    })

    it('adds the project when the target space picks exclude it', () => {
      const state = makeState(['work-api'], 'personal')

      revealRepoInProjectFilter(state, 'work-web')

      expect(state.setFilterRepoIds).toHaveBeenCalledWith(['work-api', 'work-web'])
    })

    it('does nothing when the target space already picks it', () => {
      const state = makeState(['work-api'], 'personal')

      revealRepoInProjectFilter(state, 'work-api')

      expect(state.setFilterRepoIds).not.toHaveBeenCalled()
    })
  })

  describe('for a project in no space', () => {
    const spaceless: Repo = {
      id: 'loose',
      path: '/tmp/loose',
      displayName: 'loose',
      badgeColor: '#000000',
      addedAt: 0
    }

    it('is judged by the active space, since it shows in every space', () => {
      const filtered = {
        ...makeState(['work-api'], 'work'),
        repos: [...SPACE_FILTER_REPOS, spaceless]
      }
      const unfiltered = {
        ...makeState(['work-api'], 'personal'),
        repos: [...SPACE_FILTER_REPOS, spaceless]
      }

      revealRepoInProjectFilter(filtered, 'loose')
      revealRepoInProjectFilter(unfiltered, 'loose')

      expect(filtered.setFilterRepoIds).toHaveBeenCalledWith(['work-api', 'loose'])
      expect(unfiltered.setFilterRepoIds).not.toHaveBeenCalled()
    })
  })
})
