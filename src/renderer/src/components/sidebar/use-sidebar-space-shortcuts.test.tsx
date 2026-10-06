// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProjectGroup } from '../../../../shared/project-group-types'
import { selectSidebarSpaceByIndex, useSidebarSpaceShortcuts } from './use-sidebar-space-shortcuts'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => {
  const setActive = vi.fn()
  const state: {
    projectGroups: ProjectGroup[]
    activeSidebarSpaceGroupId: string | null
    setActiveSidebarSpaceGroupId: typeof setActive
  } = {
    projectGroups: [],
    activeSidebarSpaceGroupId: null,
    setActiveSidebarSpaceGroupId: setActive
  }
  return { state, setActive }
})

vi.mock('@/store', () => ({ useAppStore: { getState: () => mocks.state } }))

function makeGroup(id: string, parentGroupId: string | null, tabOrder: number): ProjectGroup {
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

function Host(): null {
  useSidebarSpaceShortcuts()
  return null
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  mocks.state.projectGroups = [
    makeGroup('arctic-grey', null, 2),
    makeGroup('action-black', null, 0),
    makeGroup('nested', 'action-black', 1),
    makeGroup('personal', null, 1)
  ]
  mocks.state.activeSidebarSpaceGroupId = null
  mocks.setActive.mockClear()
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  Reflect.deleteProperty(window, 'api')
})

describe('selectSidebarSpaceByIndex', () => {
  it('activates the space at that position in switcher order, skipping nested groups', () => {
    selectSidebarSpaceByIndex(0)
    selectSidebarSpaceByIndex(1)
    selectSidebarSpaceByIndex(2)

    expect(mocks.setActive.mock.calls).toEqual([['action-black'], ['personal'], ['arctic-grey']])
  })

  it('does nothing when the index is past the last space', () => {
    selectSidebarSpaceByIndex(3)
    selectSidebarSpaceByIndex(-1)
    selectSidebarSpaceByIndex(0.5)

    expect(mocks.setActive).not.toHaveBeenCalled()
  })

  it('does nothing when there are no spaces', () => {
    mocks.state.projectGroups = []

    selectSidebarSpaceByIndex(0)

    expect(mocks.setActive).not.toHaveBeenCalled()
  })

  it('does nothing when that space is already active', () => {
    mocks.state.activeSidebarSpaceGroupId = 'personal'

    selectSidebarSpaceByIndex(1)

    expect(mocks.setActive).not.toHaveBeenCalled()
  })
})

describe('useSidebarSpaceShortcuts', () => {
  it('routes the bridge event to the space and unsubscribes on unmount', () => {
    const unsubscribe = vi.fn()
    const onSelectSidebarSpace = vi.fn((_callback: (index: number) => void) => unsubscribe)
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { ui: { onSelectSidebarSpace } }
    })

    act(() => {
      root.render(<Host />)
    })
    expect(onSelectSidebarSpace).toHaveBeenCalledTimes(1)

    const deliver = onSelectSidebarSpace.mock.calls[0][0]
    deliver(1)
    expect(mocks.setActive).toHaveBeenCalledWith('personal')

    deliver(9)
    expect(mocks.setActive).toHaveBeenCalledTimes(1)

    act(() => root.unmount())
    expect(unsubscribe).toHaveBeenCalledTimes(1)
    root = createRoot(container)
  })
})
