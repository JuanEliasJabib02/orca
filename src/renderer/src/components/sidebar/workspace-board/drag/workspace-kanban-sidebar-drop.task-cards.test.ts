import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { serializeWorkspaceLaneFullIds } from './workspace-kanban-filtered-drop-index'
import {
  clearWorkspaceKanbanSidebarDropTargetVisual,
  getWorkspaceKanbanSidebarDropGroups,
  resolveWorkspaceKanbanSidebarFullLaneDropIndex
} from './workspace-kanban-sidebar-drop'
import { registerWorkspaceKanbanVirtualLaneLayout } from '../viewport/workspace-kanban-virtual-lane-layout'

class FakeNode {
  parentElement: FakeElement | null = null
}

class FakeElement extends FakeNode {
  readonly children: FakeElement[] = []
  readonly dataset: Record<string, string> = {}
  readonly style = {
    setProperty: (name: string, value: string) => {
      this.styleValues.set(name, value)
    }
  }
  offsetParent: FakeElement | null = null
  scrollTop = 0
  private readonly attributes = new Map<string, string>()
  private rect: Pick<DOMRect, 'left' | 'top' | 'right' | 'bottom' | 'width' | 'height'> = {
    left: 0,
    top: 0,
    right: 0,
    bottom: 0,
    width: 0,
    height: 0
  }
  private readonly styleValues = new Map<string, string>()

  append(...elements: FakeElement[]): void {
    for (const element of elements) {
      element.parentElement = this
      this.children.push(element)
    }
  }

  appendChild(element: FakeElement): FakeElement {
    this.append(element)
    return element
  }

  remove(): void {
    if (!this.parentElement) {
      return
    }
    const siblings = this.parentElement.children
    const index = siblings.indexOf(this)
    if (index !== -1) {
      siblings.splice(index, 1)
    }
    this.parentElement = null
  }

  contains(target: FakeNode): boolean {
    return target === this || this.children.some((child) => child.contains(target))
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value)
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name)
  }

  hasAttribute(name: string): boolean {
    return this.attributes.has(name)
  }

  closest(selector: string): FakeElement | null {
    if (this.matches(selector)) {
      return this
    }
    return this.parentElement?.closest(selector) ?? null
  }

  querySelector(selector: string): FakeElement | null {
    return this.querySelectorAll(selector)[0] ?? null
  }

  querySelectorAll(selector: string): FakeElement[] {
    const results: FakeElement[] = []
    for (const child of this.children) {
      if (child.matches(selector)) {
        results.push(child)
      }
      results.push(...child.querySelectorAll(selector))
    }
    return results
  }

  getBoundingClientRect(): DOMRect {
    return this.rect as DOMRect
  }

  setRect(rect: Pick<DOMRect, 'left' | 'top' | 'right' | 'bottom' | 'width' | 'height'>): void {
    this.rect = rect
  }

  matches(selector: string): boolean {
    return selector
      .split(',')
      .map((part) => part.trim())
      .some((part) => {
        if (!part.startsWith('[') || !part.endsWith(']')) {
          return false
        }
        const attribute = part.slice(1, -1)
        return this.attributes.has(attribute)
      })
  }
}

class FakeDocument {
  readonly body = new FakeElement()
  private pointTarget: FakeElement = this.body

  createElement(): FakeElement {
    return new FakeElement()
  }

  querySelector(selector: string): FakeElement | null {
    if (this.body.matches(selector)) {
      return this.body
    }
    return this.body.querySelector(selector)
  }

  querySelectorAll(selector: string): FakeElement[] {
    const results = this.body.matches(selector) ? [this.body] : []
    results.push(...this.body.querySelectorAll(selector))
    return results
  }

  elementFromPoint(): FakeElement {
    return this.pointTarget
  }

  setElementFromPoint(element: FakeElement): void {
    this.pointTarget = element
  }
}

let fakeDocument: FakeDocument

function setRect(
  element: HTMLElement,
  rect: Pick<DOMRect, 'left' | 'top' | 'right' | 'bottom' | 'width' | 'height'>
): void {
  ;(element as unknown as FakeElement).setRect(rect)
}

function setVisible(element: HTMLElement): void {
  Object.defineProperty(element, 'offsetParent', {
    configurable: true,
    get: () => document.body
  })
}

function appendBoard(): { board: HTMLElement; lane: HTMLElement; firstCard: HTMLElement } {
  const board = document.createElement('div')
  board.setAttribute('data-workspace-board-selection-surface', '')
  setRect(board, { left: 0, top: 0, right: 320, bottom: 240, width: 320, height: 240 })

  const lane = document.createElement('section')
  lane.setAttribute('data-workspace-status-drop-target', '')
  lane.dataset.workspaceStatus = 'doing'
  setRect(lane, { left: 0, top: 0, right: 200, bottom: 220, width: 200, height: 220 })

  const firstCard = document.createElement('div')
  firstCard.setAttribute('data-workspace-board-card-id', 'doing-a')
  firstCard.dataset.workspaceBoardCardId = 'doing-a'
  setRect(firstCard, { left: 8, top: 8, right: 192, bottom: 48, width: 184, height: 40 })
  setVisible(firstCard)

  const secondCard = document.createElement('div')
  secondCard.setAttribute('data-workspace-board-card-id', 'doing-b')
  secondCard.dataset.workspaceBoardCardId = 'doing-b'
  setRect(secondCard, { left: 8, top: 56, right: 192, bottom: 96, width: 184, height: 40 })
  setVisible(secondCard)

  lane.append(firstCard, secondCard)
  board.append(lane)
  document.body.append(board)
  return { board, lane, firstCard }
}

const VIRTUAL_CARD_PITCH = 44
const VIRTUAL_CARD_HEIGHT = 36

const unregisterTaskCardLanes: (() => void)[] = []

// A virtualized lane whose second card is a task holding three worktrees.
function appendTaskCardLane(
  itemWorktreeIds: readonly (readonly string[])[] = [
    ['doing-a'],
    ['api', 'web', 'admin'],
    ['doing-b']
  ]
): { lane: HTMLElement } {
  const { lane } = appendBoard()
  const laneScroll = document.createElement('div')
  laneScroll.setAttribute('data-workspace-board-lane-scroll', '')
  const spacer = document.createElement('div')
  laneScroll.append(spacer)
  lane.append(laneScroll)
  unregisterTaskCardLanes.push(
    registerWorkspaceKanbanVirtualLaneLayout({
      scrollElement: laneScroll,
      spacerElement: spacer,
      getItemIds: () =>
        itemWorktreeIds.map((ids, index) =>
          ids.length === 1 ? ids[0]! : ids.length > 1 ? 'task:AX-1' : `project-header:${index}`
        ),
      getItemWorktreeIds: () => itemWorktreeIds,
      getMeasurements: () =>
        itemWorktreeIds.map((_, index) => ({
          index,
          start: index * VIRTUAL_CARD_PITCH,
          end: index * VIRTUAL_CARD_PITCH + VIRTUAL_CARD_HEIGHT
        }))
    })
  )
  return { lane }
}

afterEach(() => {
  for (const unregister of unregisterTaskCardLanes.splice(0)) {
    unregister()
  }
  clearWorkspaceKanbanSidebarDropTargetVisual()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

beforeEach(() => {
  fakeDocument = new FakeDocument()
  vi.stubGlobal('Node', FakeNode)
  vi.stubGlobal('Element', FakeElement)
  vi.stubGlobal('HTMLElement', FakeElement)
  vi.stubGlobal('document', fakeDocument)
})

describe('workspace kanban sidebar drop over task cards and project headers', () => {
  it('counts a task card as all of its worktrees when translating a sidebar drop', () => {
    appendTaskCardLane()

    // Cards: doing-a, a task holding api/web/admin, doing-b.
    expect(resolveWorkspaceKanbanSidebarFullLaneDropIndex('doing', 1)).toBe(1)
    expect(resolveWorkspaceKanbanSidebarFullLaneDropIndex('doing', 2)).toBe(4)
    expect(resolveWorkspaceKanbanSidebarFullLaneDropIndex('doing', 3)).toBe(5)
    expect(getWorkspaceKanbanSidebarDropGroups()).toEqual([
      { key: 'doing', worktreeIds: ['doing-a', 'api', 'web', 'admin', 'doing-b'] }
    ])
  })

  it('skips project headers when translating a sidebar drop', () => {
    // Items: header, doing-a, header, doing-b.
    appendTaskCardLane([[], ['doing-a'], [], ['doing-b']])

    expect(resolveWorkspaceKanbanSidebarFullLaneDropIndex('doing', 1)).toBe(0)
    expect(resolveWorkspaceKanbanSidebarFullLaneDropIndex('doing', 2)).toBe(1)
    expect(resolveWorkspaceKanbanSidebarFullLaneDropIndex('doing', 3)).toBe(1)
    expect(resolveWorkspaceKanbanSidebarFullLaneDropIndex('doing', 4)).toBe(2)
    expect(getWorkspaceKanbanSidebarDropGroups()).toEqual([
      { key: 'doing', worktreeIds: ['doing-a', 'doing-b'] }
    ])
  })

  it('maps a searched lane holding a task card onto the full lane', () => {
    const { lane } = appendTaskCardLane([['api', 'web', 'admin'], ['doing-b']])
    lane.dataset.workspaceLaneFullIds =
      serializeWorkspaceLaneFullIds(['doing-a', 'api', 'web', 'admin', 'doing-b']) ?? ''

    expect(resolveWorkspaceKanbanSidebarFullLaneDropIndex('doing', 0)).toBe(1)
    expect(resolveWorkspaceKanbanSidebarFullLaneDropIndex('doing', 1)).toBe(4)
    expect(resolveWorkspaceKanbanSidebarFullLaneDropIndex('doing', 2)).toBe(5)
  })
})
