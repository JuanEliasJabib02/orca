// @vitest-environment happy-dom

/**
 * Inside a space the workspace board's filter popover lists only that space's projects,
 * and a project filter picked in another space neither counts as active nor can be cleared here.
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  state: {} as Record<string, unknown>
}))

vi.mock('@/store', () => ({
  useAppStore: (selector: (state: Record<string, unknown>) => unknown) => selector(mocks.state)
}))

import { TooltipProvider } from '@/components/ui/tooltip'
import SidebarFilter from './SidebarFilter'
import { spaceFilterStoreState } from './sidebar-space-project-filter-fixtures'

let container: HTMLDivElement
let root: Root
let setFilterRepoIds: ReturnType<typeof vi.fn>

function setState(overrides: Record<string, unknown> = {}): void {
  setFilterRepoIds = vi.fn()
  mocks.state = {
    ...spaceFilterStoreState(null),
    filterRepoIds: [],
    setFilterRepoIds,
    showSleepingWorkspaces: true,
    setShowSleepingWorkspaces: vi.fn(),
    hideDefaultBranchWorkspace: false,
    setHideDefaultBranchWorkspace: vi.fn(),
    hideAutomationGeneratedWorkspaces: false,
    setHideAutomationGeneratedWorkspaces: vi.fn(),
    hideCliCreatedWorkspaces: false,
    setHideCliCreatedWorkspaces: vi.fn(),
    hideDetachedHeadWorkspaces: false,
    setHideDetachedHeadWorkspaces: vi.fn(),
    alwaysShowDefaultBranchWorkspace: true,
    setAlwaysShowDefaultBranchWorkspace: vi.fn(),
    addRepo: vi.fn(),
    ...overrides
  }
}

function render(): void {
  act(() => {
    root.render(
      <TooltipProvider>
        <SidebarFilter />
      </TooltipProvider>
    )
  })
}

function triggerButton(): HTMLButtonElement {
  const button = container.querySelector('button')
  if (!button) {
    throw new Error('filter trigger not rendered')
  }
  return button
}

function openMenu(): void {
  act(() => {
    triggerButton().dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' })
    )
  })
}

function listedProjects(): string[] {
  return Array.from(document.querySelectorAll('[data-slot="command-item"]')).map(
    (item) => item.textContent?.trim() ?? ''
  )
}

function menuButton(label: string): HTMLButtonElement | undefined {
  return Array.from(document.querySelectorAll('button')).find(
    (button) => button.textContent?.trim() === label
  )
}

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  // Radix probes pointer capture and scrolling that happy-dom does not model.
  Element.prototype.hasPointerCapture ??= () => false
  Element.prototype.setPointerCapture ??= () => {}
  Element.prototype.releasePointerCapture ??= () => {}
  Element.prototype.scrollIntoView ??= () => {}
  globalThis.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver
  setState()
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.restoreAllMocks()
})

describe('SidebarFilter project list', () => {
  it('lists only the active space projects', () => {
    setState(spaceFilterStoreState('work'))
    render()
    openMenu()

    expect(listedProjects()).toEqual(['work-api', 'work-web'])
  })

  it('lists every project when no space is active', () => {
    render()
    openMenu()

    expect(listedProjects()).toEqual(['work-api', 'work-web', 'personal-blog'])
  })

  it('hides the project list when the space holds a single project', () => {
    setState(spaceFilterStoreState('personal'))
    render()
    openMenu()

    // "Add project" proves the menu is open, so the empty list is a real absence.
    expect(menuButton('Add project')).toBeDefined()
    expect(listedProjects()).toEqual([])
    expect(menuButton('Select all')).toBeUndefined()
  })

  it('selects every project of the space with Select all', () => {
    setState(spaceFilterStoreState('work'))
    render()
    openMenu()

    act(() => menuButton('Select all')?.click())

    expect(setFilterRepoIds).toHaveBeenCalledWith(['work-api', 'work-web'])
  })

  it('disables Select all once every project of the space is selected', () => {
    setState({ ...spaceFilterStoreState('work'), filterRepoIds: ['work-api', 'work-web'] })
    render()
    openMenu()

    expect(menuButton('Select all')?.disabled).toBe(true)
  })

  it('clears the selection made inside the space', () => {
    setState({ ...spaceFilterStoreState('work'), filterRepoIds: ['work-api'] })
    render()
    openMenu()

    act(() => menuButton('Clear')?.click())

    expect(setFilterRepoIds).toHaveBeenCalledWith([])
  })

  it('leaves Clear disabled while only another space has a selection', () => {
    setState({ ...spaceFilterStoreState('work'), filterRepoIds: ['personal-blog'] })
    render()
    openMenu()

    expect(menuButton('Clear')?.disabled).toBe(true)
  })
})

describe('SidebarFilter active-filter indicator', () => {
  it('ignores a project filter picked in another space', () => {
    setState({ ...spaceFilterStoreState('work'), filterRepoIds: ['personal-blog'] })
    render()

    expect(triggerButton().getAttribute('aria-label')).toBe('Filter workspaces')
  })

  it('counts only the selected projects of the active space', () => {
    setState({ ...spaceFilterStoreState('work'), filterRepoIds: ['personal-blog', 'work-api'] })
    render()

    expect(triggerButton().getAttribute('aria-label')).toBe('Edit filters (1 active)')
  })

  it('counts every selected project when no space is active', () => {
    setState({ filterRepoIds: ['personal-blog', 'work-api'] })
    render()

    expect(triggerButton().getAttribute('aria-label')).toBe('Edit filters (2 active)')
  })
})
