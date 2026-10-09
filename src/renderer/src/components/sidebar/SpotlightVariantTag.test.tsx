// @vitest-environment happy-dom

import type { ReactNode } from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '@/store'
import type { AppState } from '@/store/types'
import { getSpotlightEnvKey } from '@/lib/spotlight-env-key'
import type { Repo } from '../../../../shared/repo-types'
import type { SpotlightServerState } from '../../../../shared/spotlight'
import type { SpotlightServerScriptDetection } from '../../../../shared/spotlight-server-types'
import type { TerminalTab } from '../../../../shared/terminal-tab-types'
import type { Worktree } from '../../../../shared/worktree/types'
import {
  holdersByRepo,
  makeSpotlightRepo,
  makeTaskWorktree
} from './worktree-list/rows/task-spotlight-test-fixtures'
import { SpotlightQuickAction } from './WorktreeCardSpotlightControls'

const chooseSpotlightVariant = vi.hoisted(() =>
  vi.fn(async (_args: { repoId: string; worktreeId: string; variant: string }) => {})
)

vi.mock('@/lib/spotlight-server-autostart', () => ({ chooseSpotlightVariant }))
vi.mock('@/lib/open-spotlight-terminal-tab', () => ({ openSpotlightTerminalTab: vi.fn() }))
vi.mock('@/components/ui/dropdown-menu', async () => {
  const { inlineDropdownMenu } = await import('./inline-dropdown-menu-fixture')
  return inlineDropdownMenu
})
vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: ReactNode }) => (
    <span data-tooltip-content="">{children}</span>
  )
}))

const initialState = useAppStore.getInitialState()
const roots: Root[] = []
const serverState =
  vi.fn<(args: { repoId: string; ptyId: string }) => Promise<SpotlightServerState>>()
const detectSpotlightServerScripts =
  vi.fn<(args: { repoId: string }) => Promise<SpotlightServerScriptDetection>>()

const MAIN = makeTaskWorktree('main-1', 'repo-a', { isMainWorktree: true })
const HOLDER = makeTaskWorktree('feature-1', 'repo-a', {
  branch: 'refs/heads/juan/AX-3447-promo',
  displayName: 'promo'
})
const OTHER = makeTaskWorktree('feature-2', 'repo-a', { branch: 'refs/heads/juan/AX-3500-x' })
const LANDING = makeSpotlightRepo('repo-a', {
  spotlightServer: { local: 'pnpm dev:{variant}', port: 3001 }
})

function variantKey(): string {
  const envKey = getSpotlightEnvKey(HOLDER, [MAIN, HOLDER, OTHER])
  if (envKey === null) {
    throw new Error('holder has no env key')
  }
  return `${envKey}::repo-a`
}

function spotlightTab(): TerminalTab {
  return {
    id: 'tab-1',
    worktreeId: MAIN.id,
    ptyId: 'pty-1',
    title: 'Spotlight',
    customTitle: null,
    color: null,
    sortOrder: 0,
    createdAt: 0,
    spotlightRepoRoot: true
  }
}

function seedStore(overrides: Partial<AppState> = {}): void {
  useAppStore.setState({
    repos: [LANDING],
    worktreesByRepo: { 'repo-a': [MAIN, HOLDER, OTHER] },
    tabsByWorktree: { [MAIN.id]: [spotlightTab()] },
    spotlightByRepo: holdersByRepo({ 'repo-a': HOLDER.id }),
    spotlightVariantByTaskRepo: { [variantKey()]: 'do' },
    ...overrides
  })
}

async function renderRow(
  worktree: Worktree,
  repo: Repo = LANDING,
  onRowClick: () => void = () => {}
): Promise<HTMLElement> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  await act(async () => {
    // Stands in for the workspace row, whose click activates the workspace.
    root.render(
      <div onClick={onRowClick}>
        <SpotlightQuickAction worktree={worktree} repo={repo} />
      </div>
    )
  })
  // The variants arrive from an async detection after the first render.
  await act(async () => {})
  return container
}

function tag(container: HTMLElement): HTMLButtonElement | null {
  return container.querySelector<HTMLButtonElement>('[data-spotlight-variant-tag]')
}

function option(container: HTMLElement, value: string): HTMLButtonElement | null {
  return container.querySelector<HTMLButtonElement>(`[data-menu-radio][data-value="${value}"]`)
}

function flashlightTooltip(container: HTMLElement): string {
  return container.querySelector('button[aria-pressed]')?.getAttribute('aria-label') ?? ''
}

describe('SpotlightVariantTag', () => {
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    vi.clearAllMocks()
    serverState.mockResolvedValue('running')
    detectSpotlightServerScripts.mockResolvedValue({
      detected: { dev: 'pnpm dev:{variant}' },
      scriptCommands: [],
      variants: ['br', 'do', 'pt']
    })
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { spotlight: { serverState }, repos: { detectSpotlightServerScripts } }
    })
    useAppStore.setState(initialState, true)
  })

  afterEach(async () => {
    for (const root of roots.splice(0)) {
      await act(async () => root.unmount())
    }
    document.body.innerHTML = ''
    Reflect.deleteProperty(window, 'api')
    useAppStore.setState(initialState, true)
  })

  it('shows the task variant next to the holder row flashlight', async () => {
    seedStore()

    const container = await renderRow(HOLDER)

    expect(tag(container)?.textContent).toBe('DO')
    expect(detectSpotlightServerScripts).toHaveBeenCalledWith({ repoId: 'repo-a' })
    expect(flashlightTooltip(container)).toContain('Server running: DO on :3001.')
  })

  it('reads "?" until a variant is picked', async () => {
    seedStore({ spotlightVariantByTaskRepo: {} })

    const container = await renderRow(HOLDER)

    expect(tag(container)?.textContent).toBe('?')
    expect(flashlightTooltip(container)).toContain('Server running on port 3001.')
  })

  it('lists every variant, the current one checked', async () => {
    seedStore()

    const container = await renderRow(HOLDER)

    const options = [...container.querySelectorAll('[data-menu-radio]')]
    expect(options.map((entry) => entry.textContent)).toEqual(['BR', 'DO', 'PT'])
    expect(option(container, 'do')?.getAttribute('aria-checked')).toBe('true')
  })

  it('choosing another variant saves it for the task and restarts that repo only', async () => {
    seedStore()
    const container = await renderRow(HOLDER)

    await act(async () => {
      option(container, 'pt')?.click()
    })

    expect(chooseSpotlightVariant).toHaveBeenCalledWith({
      repoId: 'repo-a',
      worktreeId: HOLDER.id,
      variant: 'pt'
    })
  })

  it('choosing the current variant restarts nothing', async () => {
    seedStore()
    const container = await renderRow(HOLDER)

    await act(async () => {
      option(container, 'do')?.click()
    })

    expect(chooseSpotlightVariant).not.toHaveBeenCalled()
  })

  it('does not let a click on the tag reach the workspace row', async () => {
    seedStore()
    const onRowClick = vi.fn()
    const container = await renderRow(HOLDER, LANDING, onRowClick)

    await act(async () => {
      tag(container)?.click()
      option(container, 'pt')?.click()
    })

    expect(onRowClick).not.toHaveBeenCalled()
  })

  it('shows nothing on a row that does not hold the Spotlight, and detects nothing', async () => {
    seedStore()

    const container = await renderRow(OTHER)

    expect(tag(container)).toBeNull()
    expect(detectSpotlightServerScripts).not.toHaveBeenCalled()
  })

  it('shows nothing while the Spotlight is off', async () => {
    seedStore({ spotlightByRepo: {} })

    expect(tag(await renderRow(HOLDER))).toBeNull()
  })

  it('shows nothing new for a repo without variants', async () => {
    seedStore({ repos: [makeSpotlightRepo('repo-a', { spotlightServer: { port: 3000 } })] })
    detectSpotlightServerScripts.mockResolvedValue({
      detected: { dev: 'pnpm dev' },
      scriptCommands: ['pnpm dev']
    })

    const container = await renderRow(HOLDER)

    expect(tag(container)).toBeNull()
    expect(flashlightTooltip(container)).toContain('Server running on port 3000.')
    expect(flashlightTooltip(container)).not.toContain('DO')
  })

  it('shows nothing when detection fails', async () => {
    seedStore()
    detectSpotlightServerScripts.mockRejectedValue(new Error('ipc gone'))

    expect(tag(await renderRow(HOLDER))).toBeNull()
  })

  it('names a stopped server with its variant', async () => {
    seedStore()
    serverState.mockResolvedValue('stopped')

    const container = await renderRow(HOLDER)

    expect(flashlightTooltip(container)).toContain('Server stopped (DO).')
  })
})
