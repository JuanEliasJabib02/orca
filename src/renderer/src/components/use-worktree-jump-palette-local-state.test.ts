// @vitest-environment happy-dom

import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createWorktreePaletteRequestGuard } from '@/lib/worktree-palette-create-action'
import { useAppStore } from '@/store'
import { spaceFilterStoreState } from './sidebar/sidebar-space-project-filter-fixtures'
import { useWorktreeJumpPaletteLocalState } from './use-worktree-jump-palette-local-state'

const initialState = useAppStore.getInitialState()
const createLookupGuard = createWorktreePaletteRequestGuard()

function renderLocalState(visible: boolean) {
  return renderHook(
    ({ visible: isVisible }) =>
      useWorktreeJumpPaletteLocalState({ createLookupGuard, visible: isVisible }),
    { initialProps: { visible } }
  )
}

beforeEach(() => {
  useAppStore.setState(initialState, true)
})

afterEach(() => {
  cleanup()
  useAppStore.setState(initialState, true)
})

describe('useWorktreeJumpPaletteLocalState project filter seed', () => {
  it('seeds the palette with the active space picks only', () => {
    useAppStore.setState({
      ...spaceFilterStoreState('work'),
      filterRepoIds: ['personal-blog', 'work-api']
    })

    const { result } = renderLocalState(true)

    expect(result.current.filter.repoIds).toEqual(['work-api'])
  })

  it('seeds an unfiltered palette when the only picks belong to another space', () => {
    useAppStore.setState({
      ...spaceFilterStoreState('work'),
      filterRepoIds: ['personal-blog']
    })

    const { result } = renderLocalState(true)

    expect(result.current.filter.repoIds).toEqual([])
  })

  it('keeps every pick when no space is active', () => {
    useAppStore.setState({
      ...spaceFilterStoreState(null),
      filterRepoIds: ['personal-blog', 'work-api']
    })

    const { result } = renderLocalState(true)

    expect(result.current.filter.repoIds).toEqual(['personal-blog', 'work-api'])
  })

  it('re-seeds on open from the space that is active then', () => {
    useAppStore.setState({
      ...spaceFilterStoreState('work'),
      filterRepoIds: ['personal-blog', 'work-api']
    })
    const { result, rerender } = renderLocalState(false)

    act(() => {
      useAppStore.setState({ activeSidebarSpaceGroupId: 'personal' })
    })
    rerender({ visible: true })

    expect(result.current.filter.repoIds).toEqual(['personal-blog'])
  })
})
