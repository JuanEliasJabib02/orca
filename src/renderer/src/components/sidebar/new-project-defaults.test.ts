import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProjectGroup } from '../../../../shared/project-group-types'
import type { Repo } from '../../../../shared/repo-types'
import { applyNewProjectDefaults } from './new-project-defaults'

function makeSpace(id: string): ProjectGroup {
  return {
    id,
    name: id,
    parentPath: null,
    parentGroupId: null,
    createdFrom: 'manual',
    tabOrder: 0,
    isCollapsed: false,
    color: null,
    createdAt: 0,
    updatedAt: 0
  }
}

function makeRepo(overrides: Partial<Repo> = {}): Repo {
  return {
    id: 'new-repo',
    path: '/tmp/new-repo',
    displayName: 'new-repo',
    badgeColor: '#000000',
    addedAt: 0,
    ...overrides
  }
}

describe('applyNewProjectDefaults', () => {
  const calls: string[] = []
  const moveProjectToGroup = vi.fn(async () => {
    calls.push('move')
    return true
  })
  const updateRepo = vi.fn(async () => {
    calls.push('spotlight')
    return true
  })
  let state: Parameters<typeof applyNewProjectDefaults>[1]

  beforeEach(() => {
    calls.length = 0
    moveProjectToGroup.mockClear()
    updateRepo.mockClear()
    state = {
      moveProjectToGroup,
      updateRepo,
      projectGroups: [makeSpace('arctic-grey')],
      activeSidebarSpaceGroupId: 'arctic-grey'
    }
  })

  it('files a local git project into the space, then turns Spotlight on', async () => {
    await applyNewProjectDefaults(makeRepo(), state)

    expect(calls).toEqual(['move', 'spotlight'])
    expect(updateRepo).toHaveBeenCalledWith('new-repo', { spotlightTestingEnabled: true })
  })

  it('turns Spotlight on even when there are no spaces', async () => {
    state = { ...state, projectGroups: [], activeSidebarSpaceGroupId: null }

    await applyNewProjectDefaults(makeRepo(), state)

    expect(calls).toEqual(['spotlight'])
  })

  it('leaves Spotlight off for folder and SSH projects, which cannot hold it', async () => {
    await applyNewProjectDefaults(makeRepo({ kind: 'folder' }), state)
    await applyNewProjectDefaults(makeRepo({ connectionId: 'devbox' }), state)

    expect(updateRepo).not.toHaveBeenCalled()
  })

  it('does not rewrite a flag that is already on', async () => {
    await applyNewProjectDefaults(makeRepo({ spotlightTestingEnabled: true }), state)

    expect(updateRepo).not.toHaveBeenCalled()
  })

  it('swallows a failed write so the add itself still succeeds', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    moveProjectToGroup.mockRejectedValueOnce(new Error('ipc down'))

    await expect(applyNewProjectDefaults(makeRepo(), state)).resolves.toBeUndefined()
    expect(error).toHaveBeenCalled()
    error.mockRestore()
  })
})
