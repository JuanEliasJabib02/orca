// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '@/store'
import type { ProjectGroup } from '../../../../shared/project-group-types'
import type { Repo } from '../../../../shared/repo-types'
import { fileNewRepoIntoActiveSidebarSpace } from './sidebar-space-new-project'

const initialState = useAppStore.getInitialState()

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

  beforeEach(() => {
    moveProjectToGroup.mockReset().mockResolvedValue(true)
    useAppStore.setState(initialState, true)
    useAppStore.setState({
      moveProjectToGroup,
      projectGroups: [makeSpace('action-black', 0), makeSpace('arctic-grey', 1)],
      activeSidebarSpaceGroupId: 'arctic-grey'
    })
  })

  afterEach(() => {
    useAppStore.setState(initialState, true)
  })

  it('moves a new local project into the active space', () => {
    fileNewRepoIntoActiveSidebarSpace(makeRepo())

    expect(moveProjectToGroup).toHaveBeenCalledWith('new-repo', 'arctic-grey')
  })

  it('uses the first space when none is stored yet', () => {
    useAppStore.setState({ activeSidebarSpaceGroupId: null })

    fileNewRepoIntoActiveSidebarSpace(makeRepo())

    expect(moveProjectToGroup).toHaveBeenCalledWith('new-repo', 'action-black')
  })

  it('leaves a project that already has a group where it is', () => {
    fileNewRepoIntoActiveSidebarSpace(makeRepo({ projectGroupId: 'action-black' }))

    expect(moveProjectToGroup).not.toHaveBeenCalled()
  })

  it('does not move a project from another host into a local space', () => {
    fileNewRepoIntoActiveSidebarSpace(makeRepo({ connectionId: 'devbox' }))

    expect(moveProjectToGroup).not.toHaveBeenCalled()
  })

  it('does nothing while there are no spaces', () => {
    useAppStore.setState({ projectGroups: [], activeSidebarSpaceGroupId: null })

    fileNewRepoIntoActiveSidebarSpace(makeRepo())

    expect(moveProjectToGroup).not.toHaveBeenCalled()
  })
})
