import { describe, expect, it } from 'vitest'
import { getAreaSelectionCardRects } from '../selection/workspace-kanban-area-selection-card-rects'
import { getAreaSelectionCardIds } from '../selection/workspace-kanban-area-selection-dom'
import {
  getWorkspaceKanbanVirtualLaneItemRects,
  registerWorkspaceKanbanVirtualLaneLayout,
  resolveWorkspaceKanbanVirtualLaneDropIndex
} from './workspace-kanban-virtual-lane-layout'

const ITEM_COUNT = 102
const ITEM_STRIDE = 44
const ITEM_HEIGHT = 36

function createLayoutElements(): {
  scrollElement: HTMLElement
  spacerElement: HTMLElement
} {
  const scrollElement = {
    scrollTop: 0,
    getBoundingClientRect: () => ({
      left: 20,
      top: 100,
      right: 220,
      bottom: 600,
      width: 200,
      height: 500
    })
  } as unknown as HTMLElement
  const spacerElement = {
    getBoundingClientRect: () => ({
      left: 26,
      top: 108 - scrollElement.scrollTop,
      right: 214,
      bottom: 108 - scrollElement.scrollTop + ITEM_COUNT * ITEM_STRIDE,
      width: 188,
      height: ITEM_COUNT * ITEM_STRIDE
    })
  } as unknown as HTMLElement
  return { scrollElement, spacerElement }
}

describe('workspace kanban virtual lane layout with project headers', () => {
  it('lets a marquee pass over project headers, which hold no worktree', () => {
    const { scrollElement, spacerElement } = createLayoutElements()
    const itemIds = [
      'project-header:todo:repo:api',
      'w1',
      'w2',
      'project-header:todo:repo:web',
      'w3'
    ]
    const unregister = registerWorkspaceKanbanVirtualLaneLayout({
      scrollElement,
      spacerElement,
      getItemIds: () => itemIds,
      getItemWorktreeIds: () => [[], ['w1'], ['w2'], [], ['w3']],
      getMeasurements: () =>
        itemIds.map((_, index) => ({
          index,
          start: index * ITEM_STRIDE,
          end: index * ITEM_STRIDE + ITEM_HEIGHT
        }))
    })
    const board = {
      querySelectorAll: (selector: string) =>
        selector === '[data-workspace-board-lane-scroll]' ? [scrollElement] : []
    } as unknown as HTMLElement

    expect(
      getWorkspaceKanbanVirtualLaneItemRects(scrollElement)?.map((rect) => rect.index)
    ).toEqual([1, 2, 4])
    const selectedIds = getAreaSelectionCardIds(getAreaSelectionCardRects(board), {
      left: 0,
      top: 0,
      width: 300,
      height: 600
    })
    expect(selectedIds).toEqual(['w1', 'w2', 'w3'])
    // Why: drop math still counts the header slot, so the index space is unchanged.
    expect(resolveWorkspaceKanbanVirtualLaneDropIndex(scrollElement, 600)).toBe(5)
    unregister()
  })
})
