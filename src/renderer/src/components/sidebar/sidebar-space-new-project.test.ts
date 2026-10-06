import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProjectGroup } from '../../../../shared/project-group-types'
import type { Repo } from '../../../../shared/repo-types'
import { fileNewRepoIntoActiveSidebarSpace } from './sidebar-space-new-project'

function makeSpace(
  id: string,
  tabOrder: number,
  overrides: Partial<ProjectGroup> = {}
): ProjectGroup {
  return {
    id,
    name: id,
    parentPath: null,
    parentGroupId: null,
    createdFrom: 'manual',
    tabOrder,
    isCollapsed: false,
    color: null,
    createdAt: 0,
    updatedAt: 0,
    ...overrides
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

describe('fileNewRepoIntoActiveSidebarSpace', () => {
  const moveProjectToGroup = vi.fn()
  let state: Parameters<typeof fileNewRepoIntoActiveSidebarSpace>[1]

  beforeEach(() => {
    moveProjectToGroup.mockReset().mockResolvedValue(true)
    state = {
      moveProjectToGroup,
      projectGroups: [makeSpace('action-black', 0), makeSpace('arctic-grey', 1)],
      activeSidebarSpaceGroupId: 'arctic-grey'
    }
  })

  it('moves a new local project into the active space', async () => {
    await fileNewRepoIntoActiveSidebarSpace(makeRepo(), state)

    expect(moveProjectToGroup).toHaveBeenCalledWith('new-repo', 'arctic-grey')
  })

  it('uses the first space when none is stored yet', async () => {
    state = { ...state, activeSidebarSpaceGroupId: null }

    await fileNewRepoIntoActiveSidebarSpace(makeRepo(), state)

    expect(moveProjectToGroup).toHaveBeenCalledWith('new-repo', 'action-black')
  })

  it('leaves a project that already has a group where it is', async () => {
    await fileNewRepoIntoActiveSidebarSpace(makeRepo({ projectGroupId: 'action-black' }), state)

    expect(moveProjectToGroup).not.toHaveBeenCalled()
  })

  it('does not move a project from another host into a local space', async () => {
    await fileNewRepoIntoActiveSidebarSpace(makeRepo({ connectionId: 'devbox' }), state)

    expect(moveProjectToGroup).not.toHaveBeenCalled()
  })

  it('does nothing while there are no spaces', async () => {
    state = { ...state, projectGroups: [], activeSidebarSpaceGroupId: null }

    await fileNewRepoIntoActiveSidebarSpace(makeRepo(), state)

    expect(moveProjectToGroup).not.toHaveBeenCalled()
  })
})
