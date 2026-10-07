// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '@/store'
import type { AppState } from '@/store/types'
import type { TerminalTab } from '../../../../shared/terminal-tab-types'
import {
  holdersByRepo,
  makeSpotlightRepo,
  makeTaskWorktree
} from './worktree-list/rows/task-spotlight-test-fixtures'
import {
  SPOTLIGHT_SERVER_POLL_INTERVAL_MS,
  useSpotlightServerStatus,
  type SpotlightServerStatus
} from './spotlight-server-status'

const initialState = useAppStore.getInitialState()
const roots: Root[] = []
const hasChildProcesses = vi.fn<(ptyId: string) => Promise<boolean>>()

function makeTab(overrides: Partial<TerminalTab> = {}): TerminalTab {
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
      'repo-a': [
        makeTaskWorktree('main-1', 'repo-a', { isMainWorktree: true }),
        makeTaskWorktree('feature-1', 'repo-a')
      ]
    },
    tabsByWorktree: { 'main-1': [makeTab()] },
    spotlightByRepo: holdersByRepo({ 'repo-a': 'feature-1' }),
    ...overrides
  })
}

function Probe({
  repoId,
  enabled,
  onStatus
}: {
  repoId: string
  enabled?: boolean
  onStatus: (status: SpotlightServerStatus) => void
}): null {
  onStatus(useSpotlightServerStatus(repoId, enabled))
  return null
}

async function mountProbe(
  props: { repoId?: string; enabled?: boolean } = {}
): Promise<{ latest: () => SpotlightServerStatus | null; unmount: () => Promise<void> }> {
  let latest: SpotlightServerStatus | null = null
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  await act(async () => {
    root.render(
      <Probe
        repoId={props.repoId ?? 'repo-a'}
        enabled={props.enabled}
        onStatus={(status) => {
          latest = status
        }}
      />
    )
  })
  return { latest: () => latest, unmount: () => act(async () => root.unmount()) }
}

async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

describe('useSpotlightServerStatus', () => {
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    vi.useFakeTimers()
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
    vi.useRealTimers()
    Reflect.deleteProperty(window, 'api')
    useAppStore.setState(initialState, true)
  })

  it('reports the server running with the repo port', async () => {
    seedStore()

    const probe = await mountProbe()

    expect(hasChildProcesses).toHaveBeenCalledWith('pty-1')
    expect(probe.latest()).toEqual({ running: true, port: 3000 })
  })

  it('reports the server stopped when the terminal has no child process', async () => {
    seedStore()
    hasChildProcesses.mockResolvedValue(false)

    const probe = await mountProbe()

    expect(probe.latest()).toEqual({ running: false, port: 3000 })
  })

  it('leaves the port out when the repo has none', async () => {
    seedStore({ repos: [makeSpotlightRepo('repo-a')] })

    const probe = await mountProbe()

    expect(probe.latest()).toEqual({ running: true, port: undefined })
  })

  it('polls once per interval for the repo however many rows subscribe', async () => {
    seedStore()

    await mountProbe()
    await mountProbe()
    expect(hasChildProcesses).toHaveBeenCalledTimes(1)

    await advance(SPOTLIGHT_SERVER_POLL_INTERVAL_MS)
    expect(hasChildProcesses).toHaveBeenCalledTimes(2)

    await advance(SPOTLIGHT_SERVER_POLL_INTERVAL_MS)
    expect(hasChildProcesses).toHaveBeenCalledTimes(3)
  })

  it('follows the server as it starts and stops', async () => {
    seedStore()
    hasChildProcesses.mockResolvedValueOnce(false)

    const probe = await mountProbe()
    expect(probe.latest()?.running).toBe(false)

    await advance(SPOTLIGHT_SERVER_POLL_INTERVAL_MS)
    expect(probe.latest()?.running).toBe(true)
  })

  it('keeps polling until the last subscriber leaves', async () => {
    seedStore()
    const first = await mountProbe()
    const second = await mountProbe()

    await first.unmount()
    await advance(SPOTLIGHT_SERVER_POLL_INTERVAL_MS)
    expect(hasChildProcesses).toHaveBeenCalledTimes(2)

    await second.unmount()
    await advance(SPOTLIGHT_SERVER_POLL_INTERVAL_MS * 3)
    expect(hasChildProcesses).toHaveBeenCalledTimes(2)
  })

  it('does not poll while the repo has no Spotlight', async () => {
    seedStore({ spotlightByRepo: {} })

    const probe = await mountProbe()
    await advance(SPOTLIGHT_SERVER_POLL_INTERVAL_MS * 3)

    expect(hasChildProcesses).not.toHaveBeenCalled()
    expect(probe.latest()?.running).toBeNull()
  })

  it('does not poll without a Spotlight terminal PTY', async () => {
    seedStore({ tabsByWorktree: { 'main-1': [makeTab({ ptyId: null })] } })

    const probe = await mountProbe()
    await advance(SPOTLIGHT_SERVER_POLL_INTERVAL_MS * 3)

    expect(hasChildProcesses).not.toHaveBeenCalled()
    expect(probe.latest()?.running).toBeNull()
  })

  it('ignores terminals that are not the Spotlight terminal', async () => {
    seedStore({
      tabsByWorktree: { 'main-1': [makeTab({ spotlightRepoRoot: undefined })] }
    })

    await mountProbe()

    expect(hasChildProcesses).not.toHaveBeenCalled()
  })

  it('does not poll when the row opts out', async () => {
    seedStore()

    const probe = await mountProbe({ enabled: false })
    await advance(SPOTLIGHT_SERVER_POLL_INTERVAL_MS * 2)

    expect(hasChildProcesses).not.toHaveBeenCalled()
    expect(probe.latest()).toEqual({ running: null, port: undefined })
  })

  it('stops polling and goes unknown when Spotlight turns off', async () => {
    seedStore()
    const probe = await mountProbe()
    expect(probe.latest()?.running).toBe(true)

    await act(async () => {
      useAppStore.setState({ spotlightByRepo: {} })
    })
    await advance(SPOTLIGHT_SERVER_POLL_INTERVAL_MS * 3)

    expect(hasChildProcesses).toHaveBeenCalledTimes(1)
    expect(probe.latest()?.running).toBeNull()
  })

  it('follows the terminal to its new PTY after a respawn', async () => {
    seedStore()
    await mountProbe()

    await act(async () => {
      useAppStore.setState({ tabsByWorktree: { 'main-1': [makeTab({ ptyId: 'pty-2' })] } })
    })
    await advance(SPOTLIGHT_SERVER_POLL_INTERVAL_MS)

    expect(hasChildProcesses).toHaveBeenCalledWith('pty-2')
    const callsForOldPty = hasChildProcesses.mock.calls.filter(([id]) => id === 'pty-1')
    expect(callsForOldPty).toHaveLength(1)
  })

  it('reports unknown when the check fails, then recovers', async () => {
    seedStore()
    hasChildProcesses.mockResolvedValueOnce(true).mockRejectedValueOnce(new Error('pty gone'))

    const probe = await mountProbe()
    expect(probe.latest()?.running).toBe(true)

    await advance(SPOTLIGHT_SERVER_POLL_INTERVAL_MS)
    expect(probe.latest()?.running).toBeNull()

    await advance(SPOTLIGHT_SERVER_POLL_INTERVAL_MS)
    expect(probe.latest()?.running).toBe(true)
  })

  it('does not stack checks while one is still pending', async () => {
    seedStore()
    hasChildProcesses.mockReturnValue(new Promise(() => {}))

    await mountProbe()
    await advance(SPOTLIGHT_SERVER_POLL_INTERVAL_MS * 3)

    expect(hasChildProcesses).toHaveBeenCalledTimes(1)
  })
})
