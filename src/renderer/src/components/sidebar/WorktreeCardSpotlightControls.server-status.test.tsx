// @vitest-environment happy-dom

import type { ReactNode } from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '@/store'
import type { AppState } from '@/store/types'
import type { Repo } from '../../../../shared/repo-types'
import type { TerminalTab } from '../../../../shared/terminal-tab-types'
import type { Worktree } from '../../../../shared/worktree/types'
import {
  holdersByRepo,
  makeSpotlightRepo,
  makeTaskWorktree
} from './worktree-list/rows/task-spotlight-test-fixtures'
import { SpotlightPrimaryBadge, SpotlightQuickAction } from './WorktreeCardSpotlightControls'

vi.mock('@/lib/open-spotlight-terminal-tab', () => ({ openSpotlightTerminalTab: vi.fn() }))

vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: ReactNode }) => (
    <span data-tooltip-content="">{children}</span>
  )
}))

const initialState = useAppStore.getInitialState()
const roots: Root[] = []
const hasChildProcesses = vi.fn<(ptyId: string) => Promise<boolean>>()

const HOLDER = makeTaskWorktree('feature-1', 'repo-a')
const OTHER = makeTaskWorktree('feature-2', 'repo-a')

function makeSpotlightTab(overrides: Partial<TerminalTab> = {}): TerminalTab {
  return {
    id: 'tab-1',
    worktreeId: 'main-1',
    ptyId: 'pty-1',
    title: 'Spotlight',
    customTitle: null,
    color: null,
    sortOrder: 0,
    createdAt: 0,
    spotlightRepoRoot: true,
    ...overrides
  }
}

function seedStore(overrides: Partial<AppState> = {}): void {
  useAppStore.setState({
    repos: [makeSpotlightRepo('repo-a', { spotlightServer: { local: 'pnpm local', port: 3000 } })],
    worktreesByRepo: {
      'repo-a': [makeTaskWorktree('main-1', 'repo-a', { isMainWorktree: true }), HOLDER, OTHER]
    },
    tabsByWorktree: { 'main-1': [makeSpotlightTab()] },
    spotlightByRepo: holdersByRepo({ 'repo-a': HOLDER.id }),
    ...overrides
  })
}

async function render(node: ReactNode): Promise<HTMLElement> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  await act(async () => {
    root.render(node)
  })
  return container
}

function quickAction(worktree: Worktree): Promise<HTMLElement> {
  return render(<SpotlightQuickAction worktree={worktree} repo={repoOf(worktree)} />)
}

function repoOf(worktree: Worktree): Repo {
  const repo = useAppStore.getState().repos.find((entry) => entry.id === worktree.repoId)
  if (!repo) {
    throw new Error('repo not seeded')
  }
  return repo
}

function dot(container: HTMLElement): string | null {
  return (
    container
      .querySelector('[data-spotlight-server-dot]')
      ?.getAttribute('data-spotlight-server-dot') ?? null
  )
}

function tooltipText(container: HTMLElement): string {
  return container.querySelector('[data-tooltip-content]')?.textContent ?? ''
}

describe('Spotlight server status on the flashlight', () => {
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    hasChildProcesses.mockReset()
    hasChildProcesses.mockResolvedValue(true)
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { pty: { hasChildProcesses } }
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

  describe('row flashlight', () => {
    it('shows a running dot and the port on the holder row', async () => {
      seedStore()

      const container = await quickAction(HOLDER)

      expect(dot(container)).toBe('running')
      expect(tooltipText(container)).toContain('Server running on port 3000.')
      expect(container.querySelector('button')?.getAttribute('aria-label')).toContain(
        'Server running on port 3000.'
      )
    })

    it('says only "Server running" when the repo has no port', async () => {
      seedStore({ repos: [makeSpotlightRepo('repo-a')] })

      const container = await quickAction(HOLDER)

      expect(dot(container)).toBe('running')
      expect(tooltipText(container)).toContain('Server running.')
      expect(tooltipText(container)).not.toContain('port')
    })

    it('shows a stopped dot when the terminal runs nothing', async () => {
      seedStore()
      hasChildProcesses.mockResolvedValue(false)

      const container = await quickAction(HOLDER)

      expect(dot(container)).toBe('stopped')
      expect(tooltipText(container)).toContain('Server stopped.')
    })

    it('shows no dot and no server text while the state is unknown', async () => {
      seedStore()
      hasChildProcesses.mockRejectedValue(new Error('pty gone'))

      const container = await quickAction(HOLDER)

      expect(dot(container)).toBeNull()
      expect(tooltipText(container)).not.toContain('Server')
    })

    it('keeps the holder tooltip text ahead of the server status', async () => {
      seedStore()

      const container = await quickAction(HOLDER)

      expect(tooltipText(container)).toMatch(/^Spotlight on — .* Server running on port 3000\.$/)
    })

    it('leaves rows that do not hold the Spotlight untouched and unpolled', async () => {
      seedStore()

      const container = await quickAction(OTHER)

      expect(dot(container)).toBeNull()
      expect(tooltipText(container)).not.toContain('Server')
      expect(hasChildProcesses).not.toHaveBeenCalled()
    })

    it('looks unchanged when the repo has no Spotlight', async () => {
      seedStore({ spotlightByRepo: {} })

      const container = await quickAction(HOLDER)

      expect(dot(container)).toBeNull()
      expect(tooltipText(container)).not.toContain('Server')
      expect(hasChildProcesses).not.toHaveBeenCalled()
    })
  })

  describe('primary badge', () => {
    it('shows a running dot and the port', async () => {
      seedStore()

      const container = await render(<SpotlightPrimaryBadge repo={repoOf(HOLDER)} />)

      expect(dot(container)).toBe('running')
      expect(
        container.querySelector('[data-spotlight-server-dot]')?.closest('button')
      ).not.toBeNull()
      expect(tooltipText(container)).toContain('Server running on port 3000.')
      expect(container.querySelector('button')?.getAttribute('aria-label')).toContain(
        'Server running on port 3000.'
      )
    })

    it('shows a stopped dot', async () => {
      seedStore()
      hasChildProcesses.mockResolvedValue(false)

      const container = await render(<SpotlightPrimaryBadge repo={repoOf(HOLDER)} />)

      expect(dot(container)).toBe('stopped')
      expect(tooltipText(container)).toContain('Server stopped.')
    })

    it('shows no dot while the state is unknown', async () => {
      seedStore()
      hasChildProcesses.mockRejectedValue(new Error('pty gone'))

      const container = await render(<SpotlightPrimaryBadge repo={repoOf(HOLDER)} />)

      expect(dot(container)).toBeNull()
      expect(tooltipText(container)).not.toContain('Server')
      expect(container.querySelector('button')?.getAttribute('aria-label')).toBe(
        'Spotlight is on. Click to open the server terminal.'
      )
    })

    it('renders nothing while Spotlight is off', async () => {
      seedStore({ spotlightByRepo: {} })

      const container = await render(<SpotlightPrimaryBadge repo={repoOf(HOLDER)} />)

      expect(container.innerHTML).toBe('')
      expect(hasChildProcesses).not.toHaveBeenCalled()
    })

    it('polls once for the badge and the holder flashlight together', async () => {
      seedStore()

      await render(
        <>
          <SpotlightPrimaryBadge repo={repoOf(HOLDER)} />
          <SpotlightQuickAction worktree={HOLDER} repo={repoOf(HOLDER)} />
        </>
      )

      expect(hasChildProcesses).toHaveBeenCalledTimes(1)
    })
  })
})
