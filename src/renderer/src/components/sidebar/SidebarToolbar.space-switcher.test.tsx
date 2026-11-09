// @vitest-environment happy-dom

import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppState } from '@/store/types'
import SidebarToolbar from './SidebarToolbar'

// Orca Pro Max: the footer's space switcher and test-queue flask are fork-only, so their order is pinned here.

const mocks = vi.hoisted(() => ({
  state: {
    persistedUIReady: true,
    featureInteractions: {}
  } as Partial<AppState>
}))

vi.mock('@/store', () => ({
  useAppStore: (selector: (state: Partial<AppState>) => unknown) => selector(mocks.state)
}))

vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: () => null
}))

vi.mock('./worktree-list/navigation/ScrollToCurrentWorkspaceToolbarButton', () => ({
  ScrollToCurrentWorkspaceToolbarButton: () => <button type="button">Current workspace</button>
}))

vi.mock('./SidebarSettingsHelpMenu', () => ({
  SidebarSettingsHelpMenu: () => <button type="button">Settings</button>
}))

vi.mock('./SidebarSpaceSwitcher', () => ({
  SidebarSpaceSwitcher: () => <div data-testid="space-switcher" />
}))

vi.mock('./test-queue/TestQueueButton', () => ({
  TestQueueButton: () => <button type="button">Test queue</button>
}))

const roots: Root[] = []

async function renderToolbar(): Promise<HTMLDivElement> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)

  await act(async () => {
    root.render(<SidebarToolbar workspaceBoardOpen={false} onWorkspaceBoardToggle={vi.fn()} />)
  })

  return container
}

describe('SidebarToolbar space switcher', () => {
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    window.localStorage.clear()
  })

  afterEach(() => {
    roots.splice(0).forEach((root) => {
      act(() => root.unmount())
    })
    document.body.replaceChildren()
    vi.clearAllMocks()
  })

  it('places the space switcher between the settings menu and the board button', async () => {
    const container = await renderToolbar()

    const order = Array.from(
      container.querySelectorAll('button[type="button"], [data-testid="space-switcher"]')
    ).map((element) => element.getAttribute('data-testid') ?? element.textContent)

    // Why the test queue here: its flask sits right before the crosshair.
    expect(order.slice(0, 4)).toEqual([
      'Settings',
      'space-switcher',
      'Test queue',
      'Current workspace'
    ])
  })
})
