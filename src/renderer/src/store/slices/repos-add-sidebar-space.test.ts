import { describe, expect, it, vi } from 'vitest'
import type { ProjectGroup } from '../../../../shared/project-group-types'
import { createTestStore } from './store-test-helpers'
import {
  installReposRuntimeRoutingHarness,
  localRepo,
  projectGroupsMoveProject,
  reposAdd,
  reposUpdate
} from './repos-runtime-routing-fixture'

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
    warning: vi.fn()
  }
}))

installReposRuntimeRoutingHarness()

function makeSpace(id: string, tabOrder: number): ProjectGroup {
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
    updatedAt: 0
  }
}

describe('new project defaults on add', () => {
  it('files the new project into the active space', async () => {
    reposAdd.mockResolvedValue({ repo: localRepo })
    projectGroupsMoveProject.mockResolvedValue({ ...localRepo, projectGroupId: 'arctic-grey' })
    const store = createTestStore()
    store.setState({
      projectGroups: [makeSpace('action-black', 0), makeSpace('arctic-grey', 1)],
      activeSidebarSpaceGroupId: 'arctic-grey'
    })

    await store.getState().addRepoPath(localRepo.path)

    await vi.waitFor(() =>
      expect(projectGroupsMoveProject).toHaveBeenCalledWith({
        projectId: localRepo.id,
        groupId: 'arctic-grey',
        order: undefined
      })
    )
  })

  it('leaves a project that was already added where it is', async () => {
    reposAdd.mockResolvedValue({ repo: localRepo })
    const store = createTestStore()
    store.setState({
      repos: [{ ...localRepo, executionHostId: 'local', projectGroupId: 'action-black' }],
      projectGroups: [makeSpace('action-black', 0), makeSpace('arctic-grey', 1)],
      activeSidebarSpaceGroupId: 'arctic-grey'
    })

    await store.getState().addRepoPath(localRepo.path)

    expect(projectGroupsMoveProject).not.toHaveBeenCalled()
  })

  it('does not file anything while there are no spaces', async () => {
    reposAdd.mockResolvedValue({ repo: localRepo })
    const store = createTestStore()

    await store.getState().addRepoPath(localRepo.path)

    expect(projectGroupsMoveProject).not.toHaveBeenCalled()
  })

  it('turns Spotlight on for a new local git project', async () => {
    reposAdd.mockResolvedValue({ repo: localRepo })
    reposUpdate.mockResolvedValue({ ...localRepo, spotlightTestingEnabled: true })
    const store = createTestStore()

    await store.getState().addRepoPath(localRepo.path)

    await vi.waitFor(() =>
      expect(reposUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          repoId: localRepo.id,
          updates: { spotlightTestingEnabled: true }
        })
      )
    )
  })
})
