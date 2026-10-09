// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import { useAppStore } from '@/store'
import { spaceFilterStoreState } from './sidebar-space-project-filter-fixtures'
import { useWorkspaceOptionsFilterBadge } from './workspace-options-menu-items'

const initialState = useAppStore.getInitialState()

describe('useWorkspaceOptionsFilterBadge project filter', () => {
  beforeEach(() => {
    useAppStore.setState(initialState, true)
  })

  afterEach(() => {
    cleanup()
    useAppStore.setState(initialState, true)
  })

  it('ignores a project filter picked in another space', () => {
    useAppStore.setState({ ...spaceFilterStoreState('work'), filterRepoIds: ['personal-blog'] })

    const { result } = renderHook(() => useWorkspaceOptionsFilterBadge())

    expect(result.current.hasAnyFilter).toBe(false)
    expect(result.current.activeFilterCount).toBe(0)
  })

  it('counts only the selected projects of the active space', () => {
    useAppStore.setState({
      ...spaceFilterStoreState('work'),
      filterRepoIds: ['personal-blog', 'work-api']
    })

    const { result } = renderHook(() => useWorkspaceOptionsFilterBadge())

    expect(result.current.activeFilterCount).toBe(1)
  })

  it('counts the filter again once the space is left', () => {
    useAppStore.setState({ ...spaceFilterStoreState('work'), filterRepoIds: ['personal-blog'] })

    const { result } = renderHook(() => useWorkspaceOptionsFilterBadge())
    act(() => useAppStore.setState({ activeSidebarSpaceGroupId: null }))

    expect(result.current.hasAnyFilter).toBe(true)
    expect(result.current.activeFilterCount).toBe(1)
  })
})
