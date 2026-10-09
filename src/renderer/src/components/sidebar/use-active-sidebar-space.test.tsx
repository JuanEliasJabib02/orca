// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import { useAppStore } from '@/store'
import { spaceFilterStoreState } from './sidebar-space-project-filter-fixtures'
import { useActiveSidebarSpaceScope, useActiveSpaceRepos } from './use-active-sidebar-space'

const initialState = useAppStore.getInitialState()

describe('useActiveSpaceRepos', () => {
  beforeEach(() => {
    useAppStore.setState(initialState, true)
  })

  afterEach(() => {
    cleanup()
    useAppStore.setState(initialState, true)
  })

  it('returns the store repos untouched when no space is active', () => {
    useAppStore.setState(spaceFilterStoreState(null))

    const { result } = renderHook(() => useActiveSpaceRepos())

    expect(result.current).toBe(useAppStore.getState().repos)
  })

  it('returns only the projects of the active space and follows a space switch', () => {
    useAppStore.setState(spaceFilterStoreState('work'))

    const { result } = renderHook(() => useActiveSpaceRepos())

    expect(result.current.map((repo) => repo.id)).toEqual(['work-api', 'work-web'])

    act(() => useAppStore.setState({ activeSidebarSpaceGroupId: 'personal' }))

    expect(result.current.map((repo) => repo.id)).toEqual(['personal-blog'])
  })

  it('keeps the same array across renders while its inputs are unchanged', () => {
    useAppStore.setState(spaceFilterStoreState('work'))

    const { result, rerender } = renderHook(() => useActiveSpaceRepos())
    const first = result.current
    rerender()
    act(() => useAppStore.setState({ filterRepoIds: ['work-api'] }))

    expect(result.current).toBe(first)
  })
})

describe('useActiveSidebarSpaceScope', () => {
  beforeEach(() => {
    useAppStore.setState(initialState, true)
  })

  afterEach(() => {
    cleanup()
    useAppStore.setState(initialState, true)
  })

  it('is null without an active space and resolves the space projects with one', () => {
    useAppStore.setState(spaceFilterStoreState(null))
    const { result } = renderHook(() => useActiveSidebarSpaceScope())
    expect(result.current).toBeNull()

    act(() => useAppStore.setState({ activeSidebarSpaceGroupId: 'work' }))

    expect(result.current?.repoIds).toEqual(new Set(['work-api', 'work-web']))
  })
})
