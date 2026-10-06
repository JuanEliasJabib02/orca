// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import { useAppStore } from '@/store'
import type { ProjectGroup } from '../../../../shared/project-group-types'
import { useSidebarActiveSpaceNormalization } from './use-sidebar-active-space-normalization'

const initialState = useAppStore.getInitialState()

function makeGroup(
  id: string,
  tabOrder: number,
  parentGroupId: string | null = null
): ProjectGroup {
  return {
    id,
    name: id,
    parentPath: null,
    parentGroupId,
    createdFrom: 'manual',
    tabOrder,
    isCollapsed: false,
    color: null,
    createdAt: 0,
    updatedAt: 0
  }
}

const spaces = [makeGroup('personal', 1), makeGroup('action-black', 0)]

describe('useSidebarActiveSpaceNormalization', () => {
  const setActive = vi.fn()

  beforeEach(() => {
    setActive.mockClear()
    useAppStore.setState(initialState, true)
    useAppStore.setState({ setActiveSidebarSpaceGroupId: setActive })
  })

  afterEach(() => {
    cleanup()
    useAppStore.setState(initialState, true)
  })

  it('settles an unset space on the first space once persisted UI is ready', () => {
    useAppStore.setState({ projectGroups: spaces, activeSidebarSpaceGroupId: null })
    renderHook(() => useSidebarActiveSpaceNormalization())
    expect(setActive).not.toHaveBeenCalled()

    act(() => useAppStore.setState({ persistedUIReady: true }))

    expect(setActive).toHaveBeenCalledWith('action-black')
  })

  it('moves off a deleted or nested space', () => {
    useAppStore.setState({
      persistedUIReady: true,
      projectGroups: [...spaces, makeGroup('nested', 2, 'personal')],
      activeSidebarSpaceGroupId: 'nested'
    })
    renderHook(() => useSidebarActiveSpaceNormalization())
    expect(setActive).toHaveBeenLastCalledWith('action-black')

    act(() => useAppStore.setState({ activeSidebarSpaceGroupId: 'deleted' }))
    expect(setActive).toHaveBeenLastCalledWith('action-black')
  })

  it('leaves a valid space alone', () => {
    useAppStore.setState({
      persistedUIReady: true,
      projectGroups: spaces,
      activeSidebarSpaceGroupId: 'personal'
    })
    renderHook(() => useSidebarActiveSpaceNormalization())

    expect(setActive).not.toHaveBeenCalled()
  })

  it('does nothing while there are no spaces', () => {
    useAppStore.setState({
      persistedUIReady: true,
      projectGroups: [],
      activeSidebarSpaceGroupId: null
    })
    renderHook(() => useSidebarActiveSpaceNormalization())

    expect(setActive).not.toHaveBeenCalled()
  })
})
