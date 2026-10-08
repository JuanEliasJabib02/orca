// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '@/store'
import type { AppState } from '@/store/types'
import type { SpotlightServerState } from '../../../../shared/spotlight'
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
const serverState =
  vi.fn<(args: { repoId: string; ptyId: string }) => Promise<SpotlightServerState>>()

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
    serverState.mockReset()
    serverState.mockResolvedValue('running')
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { spotlight: { serverState } }
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

    expect(serverState).toHaveBeenCalledWith({ repoId: 'repo-a', ptyId: 'pty-1' })
    expect(probe.latest()).toEqual({ running: true, port: 3000 })
  })

  it('reports the server stopped when main reads the shell at its prompt', async () => {
    seedStore()
    serverState.mockResolvedValue('stopped')

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
    expect(serverState).toHaveBeenCalledTimes(1)

    await advance(SPOTLIGHT_SERVER_POLL_INTERVAL_MS)
    expect(serverState).toHaveBeenCalledTimes(2)

    await advance(SPOTLIGHT_SERVER_POLL_INTERVAL_MS)
    expect(serverState).toHaveBeenCalledTimes(3)
  })

  it('follows the server as it starts and stops', async () => {
    seedStore()
    serverState.mockResolvedValueOnce('stopped')

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
    expect(serverState).toHaveBeenCalledTimes(2)

    await second.unmount()
    await advance(SPOTLIGHT_SERVER_POLL_INTERVAL_MS * 3)
    expect(serverState).toHaveBeenCalledTimes(2)
  })

  it('does not poll while the repo has no Spotlight', async () => {
    seedStore({ spotlightByRepo: {} })

    const probe = await mountProbe()
    await advance(SPOTLIGHT_SERVER_POLL_INTERVAL_MS * 3)

    expect(serverState).not.toHaveBeenCalled()
    expect(probe.latest()?.running).toBeNull()
  })

  it('does not poll without a Spotlight terminal PTY', async () => {
    seedStore({ tabsByWorktree: { 'main-1': [makeTab({ ptyId: null })] } })

    const probe = await mountProbe()
    await advance(SPOTLIGHT_SERVER_POLL_INTERVAL_MS * 3)

    expect(serverState).not.toHaveBeenCalled()
    expect(probe.latest()?.running).toBeNull()
  })

  it('ignores terminals that are not the Spotlight terminal', async () => {
    seedStore({
      tabsByWorktree: { 'main-1': [makeTab({ spotlightRepoRoot: undefined })] }
    })

    await mountProbe()

    expect(serverState).not.toHaveBeenCalled()
  })

  it('does not poll when the row opts out', async () => {
    seedStore()

    const probe = await mountProbe({ enabled: false })
    await advance(SPOTLIGHT_SERVER_POLL_INTERVAL_MS * 2)

    expect(serverState).not.toHaveBeenCalled()
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

    expect(serverState).toHaveBeenCalledTimes(1)
    expect(probe.latest()?.running).toBeNull()
  })

  it('follows the terminal to its new PTY after a respawn', async () => {
    seedStore()
    await mountProbe()

    await act(async () => {
      useAppStore.setState({ tabsByWorktree: { 'main-1': [makeTab({ ptyId: 'pty-2' })] } })
    })
    await advance(SPOTLIGHT_SERVER_POLL_INTERVAL_MS)

    expect(serverState).toHaveBeenCalledWith({ repoId: 'repo-a', ptyId: 'pty-2' })
    const callsForOldPty = serverState.mock.calls.filter(([args]) => args.ptyId === 'pty-1')
    expect(callsForOldPty).toHaveLength(1)
  })

  it('reports unknown when the check fails, then recovers', async () => {
    seedStore()
    serverState.mockResolvedValueOnce('running').mockRejectedValueOnce(new Error('pty gone'))

    const probe = await mountProbe()
    expect(probe.latest()?.running).toBe(true)

    await advance(SPOTLIGHT_SERVER_POLL_INTERVAL_MS)
    expect(probe.latest()?.running).toBeNull()

    await advance(SPOTLIGHT_SERVER_POLL_INTERVAL_MS)
    expect(probe.latest()?.running).toBe(true)
  })

  it('reports unknown when main cannot read the terminal', async () => {
    seedStore()
    serverState.mockResolvedValue('unknown')

    const probe = await mountProbe()

    expect(probe.latest()?.running).toBeNull()
  })

  it('checks every repo on one shared tick', async () => {
    seedStore({
      repos: [makeSpotlightRepo('repo-a'), makeSpotlightRepo('repo-b')],
      worktreesByRepo: {
        'repo-a': [
          makeTaskWorktree('main-1', 'repo-a', { isMainWorktree: true }),
          makeTaskWorktree('feature-1', 'repo-a')
        ],
        'repo-b': [
          makeTaskWorktree('main-2', 'repo-b', { isMainWorktree: true }),
          makeTaskWorktree('feature-2', 'repo-b')
        ]
      },
      tabsByWorktree: {
        'main-1': [makeTab()],
        'main-2': [makeTab({ id: 'tab-2', worktreeId: 'main-2', ptyId: 'pty-2' })]
      },
      spotlightByRepo: holdersByRepo({ 'repo-a': 'feature-1', 'repo-b': 'feature-2' })
    })
    await mountProbe()
    await advance(SPOTLIGHT_SERVER_POLL_INTERVAL_MS / 2)
    await mountProbe({ repoId: 'repo-b' })
    serverState.mockClear()

    await advance(SPOTLIGHT_SERVER_POLL_INTERVAL_MS / 2)

    expect(serverState.mock.calls.map(([args]) => args.ptyId).sort()).toEqual(['pty-1', 'pty-2'])
  })

  it('does not stack checks while one is still pending', async () => {
    seedStore()
    serverState.mockReturnValue(new Promise(() => {}))

    await mountProbe()
    await advance(SPOTLIGHT_SERVER_POLL_INTERVAL_MS * 3)

    expect(serverState).toHaveBeenCalledTimes(1)
  })
})
