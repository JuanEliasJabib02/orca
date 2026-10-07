// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '@/store'
import {
  makeSpotlightRepo,
  makeTaskWorktree
} from './worktree-list/rows/task-spotlight-test-fixtures'
import {
  WorktreeSpotlightMenuItems,
  type WorktreeSpotlightMenuModel
} from './WorktreeSpotlightMenuItems'

vi.mock('@/lib/spotlight-server-autostart', () => ({ applySpotlightEnvChange: vi.fn() }))
vi.mock('@/components/ui/dropdown-menu', async () => {
  const { inlineDropdownMenu } = await import('./inline-dropdown-menu-fixture')
  return inlineDropdownMenu
})
vi.mock('lucide-react', async () =>
  (await import('../tab-bar/lucide-icon-stub-fixture')).stubEveryIcon()
)

const initialState = useAppStore.getInitialState()
const roots: Root[] = []

const WORKTREE = makeTaskWorktree('ad-1', 'admin', { branch: 'refs/heads/juan/AX-3448-ui' })

function makeModel(
  overrides: Partial<WorktreeSpotlightMenuModel> = {}
): WorktreeSpotlightMenuModel {
  return {
    handleForceSyncSpotlight: vi.fn(),
    handleToggleSpotlight: vi.fn(),
    isDeleting: false,
    repo: null,
    spotlight: { active: false, holderWorktreeId: null, syncing: false, rootDiverged: false },
    spotlightEligible: true,
    spotlightHeldHere: false,
    spotlightOffOnMain: false,
    worktree: WORKTREE,
    ...overrides
  }
}

async function render(model: WorktreeSpotlightMenuModel): Promise<HTMLElement> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  await act(async () => {
    root.render(<WorktreeSpotlightMenuItems model={model} />)
  })
  return container
}

function itemLabels(container: HTMLElement): (string | null)[] {
  return Array.from(container.querySelectorAll('[data-menu-item]')).map((item) => item.textContent)
}

function hasEnvSubMenu(container: HTMLElement): boolean {
  return container.querySelector('[data-sub-trigger]') !== null
}

describe('WorktreeSpotlightMenuItems', () => {
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    vi.clearAllMocks()
    vi.stubGlobal('api', { ui: { set: vi.fn(() => Promise.resolve()) } })
    useAppStore.setState(initialState, true)
    useAppStore.setState({ worktreesByRepo: { admin: [WORKTREE] } })
  })

  afterEach(async () => {
    for (const root of roots.splice(0)) {
      await act(async () => root.unmount())
    }
    document.body.innerHTML = ''
    vi.unstubAllGlobals()
    useAppStore.setState(initialState, true)
  })

  it('offers to spotlight an eligible workspace, with the environment submenu next to it', async () => {
    const model = makeModel()
    const container = await render(model)

    expect(itemLabels(container)).toEqual(['Spotlight This Workspace'])
    expect(hasEnvSubMenu(container)).toBe(true)

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-menu-item]')?.click()
    })
    expect(model.handleToggleSpotlight).toHaveBeenCalledTimes(1)
  })

  it('offers to turn the Spotlight off for the workspace holding it', async () => {
    const container = await render(makeModel({ spotlightHeldHere: true }))

    expect(itemLabels(container)).toEqual(['Turn Off Spotlight'])
    expect(hasEnvSubMenu(container)).toBe(true)
  })

  it('offers the destructive force sync only to the holder whose root diverged', async () => {
    const repo = makeSpotlightRepo('admin')
    const diverged = { active: true, holderWorktreeId: 'ad-1', syncing: false, rootDiverged: true }
    const model = makeModel({ repo, spotlightHeldHere: true, spotlight: diverged })

    const container = await render(model)
    const forceSync = container.querySelector<HTMLButtonElement>('[data-variant="destructive"]')

    expect(forceSync?.textContent).toBe('Force Sync Spotlight (overwrite root changes)')
    await act(async () => {
      forceSync?.click()
    })
    expect(model.handleForceSyncSpotlight).toHaveBeenCalledTimes(1)

    const other = await render(makeModel({ repo, spotlight: diverged }))
    expect(other.querySelector('[data-variant="destructive"]')).toBeNull()
  })

  it('offers only the off switch on the main worktree, with no environment submenu', async () => {
    const container = await render(
      makeModel({ spotlightEligible: false, spotlightOffOnMain: true })
    )

    expect(itemLabels(container)).toEqual(['Turn Off Spotlight'])
    expect(hasEnvSubMenu(container)).toBe(false)
  })

  it('shows nothing for a workspace that cannot hold a Spotlight', async () => {
    const container = await render(makeModel({ spotlightEligible: false }))

    expect(itemLabels(container)).toEqual([])
    expect(hasEnvSubMenu(container)).toBe(false)
  })

  it('disables the toggle while the Spotlight is syncing or the workspace is being deleted', async () => {
    const syncing = await render(
      makeModel({
        spotlight: { active: true, holderWorktreeId: null, syncing: true, rootDiverged: false }
      })
    )
    const deleting = await render(makeModel({ isDeleting: true }))

    expect(syncing.querySelector<HTMLButtonElement>('[data-menu-item]')?.disabled).toBe(true)
    expect(deleting.querySelector<HTMLButtonElement>('[data-menu-item]')?.disabled).toBe(true)
  })
})
