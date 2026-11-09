// @vitest-environment happy-dom

/** Orca Pro Max: the Projects filter scoped to the active sidebar space, a fork-only feature. */

import { act, type ComponentProps } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  state: {} as Record<string, unknown>
}))

vi.mock('@/store', () => ({
  useAppStore: (selector: (state: Record<string, unknown>) => unknown) => selector(mocks.state)
}))

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import SidebarRepositoryFilterSection from './SidebarRepositoryFilterSection'
import { spaceFilterStoreState } from '../../sidebar-space-project-filter-fixtures'

let container: HTMLDivElement
let root: Root
let setFilterRepoIds: ReturnType<typeof vi.fn>

function setState(overrides: Record<string, unknown> = {}): void {
  setFilterRepoIds = vi.fn()
  mocks.state = {
    filterRepoIds: [],
    setFilterRepoIds,
    ...overrides
  }
}

function render(props: ComponentProps<typeof SidebarRepositoryFilterSection> = {}): void {
  act(() => {
    root.render(
      <DropdownMenu defaultOpen>
        <DropdownMenuTrigger>Options</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>Sort by</DropdownMenuItem>
          <SidebarRepositoryFilterSection {...props} />
        </DropdownMenuContent>
      </DropdownMenu>
    )
  })
}

function openSubmenu(): void {
  const trigger = document.querySelector<HTMLElement>('[data-slot="dropdown-menu-sub-trigger"]')
  if (!trigger) {
    throw new Error('sub-trigger not rendered')
  }
  act(() => {
    trigger.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse' }))
    trigger.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'mouse' }))
    trigger.click()
  })
}

function listedProjects(): string[] {
  return Array.from(document.querySelectorAll('[data-slot="command-item"]')).map(
    (item) => item.textContent?.trim() ?? ''
  )
}

function triggerLabel(): string {
  return (
    document.querySelector('[data-slot="dropdown-menu-sub-trigger"]')?.textContent?.trim() ?? ''
  )
}

function clearButton(): HTMLButtonElement | undefined {
  return Array.from(document.querySelectorAll('button')).find(
    (button) => button.textContent?.trim() === 'Clear'
  )
}

/** Allow deferred focus to settle through one frame and a macrotask. */
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)))
  })
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

describe('SidebarRepositoryFilterSection inside a space', () => {
  it('lists only the active space projects', async () => {
    setState(spaceFilterStoreState('work'))
    render()
    openSubmenu()
    await settle()

    expect(listedProjects()).toEqual(['work-api', 'work-web'])
  })

  it('lists every project when no space is active', async () => {
    setState(spaceFilterStoreState(null))
    render()
    openSubmenu()
    await settle()

    expect(listedProjects()).toEqual(['work-api', 'work-web', 'personal-blog'])
  })

  it('reads All projects when the filter only names projects of another space', () => {
    setState({ ...spaceFilterStoreState('work'), filterRepoIds: ['personal-blog'] })
    render()

    expect(triggerLabel()).toContain('All projects')
  })

  it('counts only the selected projects of the active space', () => {
    setState({
      ...spaceFilterStoreState('work'),
      filterRepoIds: ['personal-blog', 'work-api', 'work-web']
    })
    render()

    expect(triggerLabel()).toContain('2 projects')
  })

  it('names the single selected project of the active space', async () => {
    setState({ ...spaceFilterStoreState('work'), filterRepoIds: ['personal-blog', 'work-web'] })
    render()
    openSubmenu()
    await settle()

    expect(triggerLabel()).toContain('work-web')
    expect(listedProjects()).toEqual(['work-api'])
  })

  it('leaves Clear disabled while only another space has a selection', async () => {
    setState({ ...spaceFilterStoreState('work'), filterRepoIds: ['personal-blog'] })
    render()
    openSubmenu()
    await settle()

    expect(clearButton()?.disabled).toBe(true)
  })

  it('clears only the active space and keeps the selection made in another space', async () => {
    setState({ ...spaceFilterStoreState('work'), filterRepoIds: ['personal-blog', 'work-api'] })
    render()
    openSubmenu()
    await settle()

    act(() => clearButton()?.click())

    expect(setFilterRepoIds).toHaveBeenCalledWith(['personal-blog'])
  })

  it('hides itself when the space holds a single project', () => {
    setState(spaceFilterStoreState('personal'))
    render()

    expect(document.querySelector('[data-slot="dropdown-menu-sub-trigger"]')).toBeNull()
  })

  it('keeps listing every project for a caller that brings its own filter', async () => {
    // "personal" holds one project, so the workspace-nav filter would hide itself here.
    setState(spaceFilterStoreState('personal'))
    render({ filterRepoIds: ['work-api'], setFilterRepoIds: vi.fn() })
    openSubmenu()
    await settle()

    expect(triggerLabel()).toContain('work-api')
    expect(listedProjects()).toEqual(['work-web', 'personal-blog'])
  })
})
