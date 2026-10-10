// @vitest-environment happy-dom

import { cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useAppStore } from '@/store'
import type { Repo } from '../../../../shared/repo-types'
import { makeRepo } from '../worktree-jump-palette-test-fixtures'
import { useWorkspaceKanbanProjectSections } from './use-workspace-kanban-project-sections'

const initialState = useAppStore.getInitialState()

function repo(id: string): Repo {
  return { ...makeRepo(), id, path: `/repos/${id}`, displayName: id }
}

const repos = [repo('web'), repo('api')]
const repoMap = new Map(repos.map((entry) => [entry.id, entry]))

beforeEach(() => {
  useAppStore.setState(initialState, true)
  useAppStore.setState({ repos, projectOrderBy: 'recent' })
})

afterEach(() => {
  cleanup()
  useAppStore.setState(initialState, true)
})

describe('useWorkspaceKanbanProjectSections', () => {
  it('is null outside Group by → Project, so every other board mode stays unsectioned', () => {
    const { result } = renderHook(() => useWorkspaceKanbanProjectSections(false, repoMap))

    expect(result.current).toBeNull()
  })

  it("carries the sidebar's project order inputs in Group by → Project", () => {
    const { result } = renderHook(() => useWorkspaceKanbanProjectSections(true, repoMap))

    expect(result.current?.repoMap).toBe(repoMap)
    expect(result.current?.projectOrderBy).toBe('recent')
    expect(result.current?.repoOrder).toEqual(
      new Map([
        ['web', 0],
        ['api', 1]
      ])
    )
  })
})
