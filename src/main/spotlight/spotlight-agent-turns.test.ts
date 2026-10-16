import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Repo } from '../../shared/repo-types'
import type { SpotlightRepoState } from '../../shared/spotlight'
import type { SpotlightAgentTaskResolution } from '../../shared/spotlight-agent-turn'
import type { WorkspacePort, WorkspacePortScanResult } from '../../shared/workspace-ports'
import { SpotlightAgentTurns } from './spotlight-agent-turns'

function makeRepo(id: string, port?: number): Repo {
  return {
    id,
    path: `/repos/${id}`,
    displayName: id,
    badgeColor: '#000',
    addedAt: 0,
    ...(port === undefined ? {} : { spotlightServer: { port } })
  }
}

function rootPort(repoId: string, port: number, path = `/repos/${repoId}`): WorkspacePort {
  return {
    id: `${repoId}:${port}`,
    kind: 'workspace',
    bindHost: '*',
    connectHost: 'localhost',
    port,
    protocol: 'http',
    owner: {
      worktreeId: `${repoId}::${path}`,
      repoId,
      displayName: repoId,
      path,
      confidence: 'cwd'
    }
  }
}

/** Two tasks: AX-1 in back+admin, AX-2 in back only. */
const TASKS: Record<string, SpotlightAgentTaskResolution> = {
  'back::/wt/ax-1': {
    taskKey: 'AX-1',
    members: [
      {
        repoId: 'back',
        repoName: 'back',
        worktreeId: 'back::/wt/ax-1',
        taskWorktreeIds: ['back::/wt/ax-1']
      },
      {
        repoId: 'admin',
        repoName: 'admin',
        worktreeId: 'admin::/wt/ax-1',
        taskWorktreeIds: ['admin::/wt/ax-1']
      }
    ],
    skippedRepoNames: []
  },
  'back::/wt/ax-2': {
    taskKey: 'AX-2',
    members: [
      {
        repoId: 'back',
        repoName: 'back',
        worktreeId: 'back::/wt/ax-2',
        taskWorktreeIds: ['back::/wt/ax-2']
      }
    ],
    skippedRepoNames: []
  }
}

function setup(options: { ports?: WorkspacePort[]; server?: 'running' | 'stopped' } = {}) {
  const repos = new Map([
    ['back', makeRepo('back', 8080)],
    ['admin', makeRepo('admin')]
  ])
  const holders = new Map<string, string>()
  let ports = options.ports ?? [rootPort('back', 8080), rootPort('admin', 3000)]
  const lightTask = vi.fn(async (worktreeId: string, repoIds: string[]) => {
    for (const member of TASKS[worktreeId].members) {
      if (repoIds.includes(member.repoId)) {
        holders.set(member.repoId, member.worktreeId)
      }
    }
    return repoIds.map((repoId) => ({ repoId, ok: true }))
  })
  const turns = new SpotlightAgentTurns({
    getRepo: (repoId) => repos.get(repoId),
    getSpotlightState: (repoId): SpotlightRepoState | null => {
      const holder = holders.get(repoId)
      return holder
        ? {
            repoId,
            holderWorktreeId: holder,
            status: 'active',
            originalBranch: 'main',
            originalHeadSha: 'sha',
            backupSha: 'sha',
            lastSnapshotSha: null,
            activatedAt: 0,
            lastSyncAt: null,
            lastError: null
          }
        : null
    },
    listSpotlightStates: () => [],
    resolveTask: async (worktreeId) => TASKS[worktreeId],
    lightTask,
    readServer: async () => options.server ?? 'running'
  })
  const scanPorts = async (): Promise<WorkspacePortScanResult> => ({
    platform: 'darwin',
    scannedAt: 0,
    ports
  })
  return {
    turns,
    lightTask,
    holders,
    scanPorts,
    setPorts: (next: WorkspacePort[]) => {
      ports = next
    }
  }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('SpotlightAgentTurns', () => {
  it('lights the task and reports each server once it listens', async () => {
    const { turns, scanPorts } = setup()

    const result = await turns.on({ paneKey: 'p1', worktreeId: 'back::/wt/ax-1', scanPorts })

    expect(result).toMatchObject({ status: 'on', taskKey: 'AX-1', ready: true })
    expect(result.status === 'on' && result.servers).toEqual([
      expect.objectContaining({
        repoName: 'back',
        lit: true,
        port: 8080,
        url: 'http://localhost:8080',
        listening: true,
        logPath: '/repos/back/.orca/spotlight.log'
      }),
      expect.objectContaining({ repoName: 'admin', lit: true, port: 3000, listening: true })
    ])
  })

  it('waits for the configured port and ignores ports of other worktrees', async () => {
    const { turns, scanPorts, setPorts } = setup({
      ports: [rootPort('back', 9999), rootPort('admin', 3000, '/wt/ax-1-admin')]
    })

    const pending = turns.on({
      paneKey: 'p1',
      worktreeId: 'back::/wt/ax-1',
      timeoutMs: 20_000,
      scanPorts
    })
    await vi.advanceTimersByTimeAsync(5_000)
    setPorts([rootPort('back', 8080), rootPort('admin', 3001)])
    await vi.advanceTimersByTimeAsync(5_000)
    const result = await pending

    expect(result).toMatchObject({ status: 'on', ready: true })
    expect(result.status === 'on' && result.servers.map((server) => server.port)).toEqual([
      8080, 3001
    ])
  })

  it('stops waiting for a project whose terminal runs no server', async () => {
    const { turns, scanPorts } = setup({ ports: [], server: 'stopped' })

    const pending = turns.on({
      paneKey: 'p1',
      worktreeId: 'back::/wt/ax-1',
      timeoutMs: 90_000,
      scanPorts
    })
    await vi.advanceTimersByTimeAsync(20_000)

    await expect(pending).resolves.toMatchObject({ status: 'on', ready: false })
  })

  it('makes a task that shares a project wait, then lights it as soon as the holder gives it back', async () => {
    const { turns, scanPorts, lightTask, holders } = setup()
    await turns.on({ paneKey: 'p1', worktreeId: 'back::/wt/ax-1', scanPorts })

    const waiting = turns.on({
      paneKey: 'p2',
      worktreeId: 'back::/wt/ax-2',
      timeoutMs: 1_000,
      scanPorts
    })
    await vi.advanceTimersByTimeAsync(1_000)
    await expect(waiting).resolves.toEqual({
      status: 'waiting',
      taskKey: 'AX-2',
      position: 1,
      blockers: [{ taskKey: 'AX-1', repoNames: ['back'], holding: true }]
    })

    // Nobody is inside `on` for AX-2 now: the grant still lights it right away.
    expect(turns.off('p1')).toEqual({
      releasedTaskKey: 'AX-1',
      wasWaiting: false,
      nextTaskKeys: ['AX-2']
    })
    await vi.advanceTimersByTimeAsync(0)
    expect(lightTask).toHaveBeenLastCalledWith('back::/wt/ax-2', ['back'])
    expect(holders.get('back')).toBe('back::/wt/ax-2')
  })

  it('wakes a waiting call when its turn comes', async () => {
    const { turns, scanPorts } = setup()
    await turns.on({ paneKey: 'p1', worktreeId: 'back::/wt/ax-1', scanPorts })
    const waiting = turns.on({
      paneKey: 'p2',
      worktreeId: 'back::/wt/ax-2',
      timeoutMs: 60_000,
      scanPorts
    })
    await vi.advanceTimersByTimeAsync(10)

    turns.off('p1')

    await expect(waiting).resolves.toMatchObject({ status: 'on', taskKey: 'AX-2', ready: true })
  })

  it("releases a turn when its agent finishes, but not on a 'done' older than the request", async () => {
    const { turns, scanPorts } = setup()
    await turns.on({ paneKey: 'p1', worktreeId: 'back::/wt/ax-1', scanPorts })
    const requestedAt = Date.now()

    turns.handleAgentStatuses([
      { paneKey: 'p1', state: 'done', receivedAt: requestedAt - 1, observedInCurrentRuntime: true }
    ])
    expect(turns.status().turns).toHaveLength(1)

    turns.handleAgentStatuses([
      { paneKey: 'p1', state: 'done', receivedAt: requestedAt + 1, observedInCurrentRuntime: true }
    ])
    expect(turns.status().turns).toEqual([])
  })

  it('releases a turn when its terminal closes', async () => {
    const { turns, scanPorts } = setup()
    await turns.on({ paneKey: 'p1', worktreeId: 'back::/wt/ax-1', scanPorts })

    turns.handlePaneGone('p1')

    expect(turns.status().turns).toEqual([])
  })

  it('refuses a task with no project that can hold a Spotlight', async () => {
    const turns = new SpotlightAgentTurns({
      getRepo: () => undefined,
      getSpotlightState: () => null,
      listSpotlightStates: () => [],
      resolveTask: async () => ({ taskKey: 'AX-9', members: [], skippedRepoNames: ['landing'] }),
      lightTask: async () => [],
      readServer: async () => 'unknown'
    })

    await expect(
      turns.on({ paneKey: 'p1', worktreeId: 'x', scanPorts: async () => null })
    ).rejects.toThrow('Spotlight is off for: landing')
  })
})
