// @vitest-environment happy-dom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProjectGroup } from '../../../../shared/project-group-types'
import SidebarHeader from './SidebarHeader'

// Orca Pro Max: the sidebar title names the active space, a fork-only feature, so its cases live here.

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

type MockState = {
  groupBy: string
  projectGroups: ProjectGroup[]
  activeSidebarSpaceGroupId: string | null
  sidebarBody: 'workspaces' | 'agents'
  setSidebarBody: (body: 'workspaces' | 'agents') => void
  updateSettings: (patch: Record<string, unknown>) => void
  settings?: {
    agentsSidebarIntroShown?: boolean
    agentsSidebarMigratedFromExperimental?: boolean
  }
}

let mockState: MockState

vi.mock('@/store', () => {
  const useAppStore = (selector: (state: MockState) => unknown) => selector(mockState)
  useAppStore.getState = () => mockState
  return { useAppStore }
})

// The title is what these cases read; the action buttons bring their own store and menu wiring.
vi.mock('./sidebar-header-actions', () => ({
  SidebarHeaderActions: () => null
}))

vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => <>{children}</>
}))

// Expose open state directly to isolate this header test from Radix portals.
vi.mock('@/components/ui/popover', () => ({
  Popover: ({ children, open }: { children: React.ReactNode; open?: boolean }) => (
    <div data-intro-open={open ? '' : undefined}>{children}</div>
  ),
  PopoverAnchor: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  PopoverArrow: () => <div data-testid="popover-arrow" />,
  PopoverContent: ({ children }: { children: React.ReactNode }) => <>{children}</>
}))

let container: HTMLDivElement
let root: Root

function makeSpace(id: string, name: string, tabOrder: number): ProjectGroup {
  return {
    id,
    name,
    parentPath: null,
    parentGroupId: null,
    createdFrom: 'manual',
    tabOrder,
    isCollapsed: false,
    color: null,
    createdAt: 0,
    updatedAt: 0
  }
}

function sectionTitle(): HTMLElement {
  const title = container.querySelector<HTMLElement>('[data-sidebar-section-title]')
  if (!title) {
    throw new Error('Sidebar section title not rendered')
  }
  return title
}

function renderHeader(): void {
  act(() => {
    root.render(<SidebarHeader onWorkspaceBoardMenuOpenChange={vi.fn()} />)
  })
}

beforeEach(() => {
  mockState = {
    groupBy: 'repo',
    projectGroups: [makeSpace('work', 'Work', 1), makeSpace('home', 'Home', 0)],
    activeSidebarSpaceGroupId: null,
    sidebarBody: 'workspaces',
    setSidebarBody: vi.fn(),
    updateSettings: vi.fn(),
    settings: {}
  }
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('SidebarHeader space title', () => {
  it('shows the active space name with the full name in the title attribute', () => {
    mockState.activeSidebarSpaceGroupId = 'work'
    renderHeader()

    expect(sectionTitle().textContent).toBe('Work')
    expect(sectionTitle().getAttribute('title')).toBe('Work')
  })

  it('shows the space name whatever the grouping, and tracks a switch', () => {
    mockState.groupBy = 'workspace-status'
    mockState.activeSidebarSpaceGroupId = 'work'
    renderHeader()
    expect(sectionTitle().textContent).toBe('Work')

    mockState.activeSidebarSpaceGroupId = 'home'
    renderHeader()
    expect(sectionTitle().textContent).toBe('Home')
  })

  it('falls back to the first space when the active id is unset', () => {
    renderHeader()

    expect(sectionTitle().textContent).toBe('Home')
  })

  it('falls back to the first space when the active id is no longer a space', () => {
    mockState.activeSidebarSpaceGroupId = 'deleted'
    renderHeader()

    expect(sectionTitle().textContent).toBe('Home')
  })

  it('ignores nested groups when picking the space', () => {
    mockState.projectGroups = [
      { ...makeSpace('nested', 'Nested', 0), parentGroupId: 'work' },
      makeSpace('work', 'Work', 1)
    ]
    mockState.activeSidebarSpaceGroupId = 'nested'
    renderHeader()

    expect(sectionTitle().textContent).toBe('Work')
  })

  it('keeps the original label in the agents view', () => {
    mockState.activeSidebarSpaceGroupId = 'work'
    mockState.sidebarBody = 'agents'
    renderHeader()

    expect(sectionTitle().textContent).toBe('Projects')
    expect(sectionTitle().hasAttribute('title')).toBe(false)
  })

  it('keeps the original label and no title attribute when no spaces exist', () => {
    mockState.projectGroups = []
    renderHeader()
    expect(sectionTitle().textContent).toBe('Projects')
    expect(sectionTitle().hasAttribute('title')).toBe(false)

    mockState.groupBy = 'workspace-status'
    renderHeader()
    expect(sectionTitle().textContent).toBe('Workspaces')
  })
})
