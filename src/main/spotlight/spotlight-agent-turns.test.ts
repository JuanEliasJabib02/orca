import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  ClaudeManagedAccount,
  ClaudeManagedAccountSummary
} from '../../shared/managed-account-types'
import type { InactiveAccountUsage, ProviderRateLimits } from '../../shared/rate-limit-types'
import type { Repo } from '../../shared/repo-types'
import type { SpotlightRepoState } from '../../shared/spotlight'
import type {
  SpotlightAgentStatus,
  SpotlightAgentTaskResolution
} from '../../shared/spotlight-agent-turn'
import type { WorkspacePort, WorkspacePortScanResult } from '../../shared/workspace-ports'
import { _internals } from '../agent-hooks/server/agent-hook-server'
import { buildBody } from '../agent-hooks/server/testing/server.test-fixtures'
import { readTurnEndFromRows, type SpotlightTurnEndRow } from './spotlight-agent-turn-pause'
import { isPaneAccountAtLimit } from './spotlight-agent-turn-usage'
import { SpotlightAgentTurns } from './spotlight-agent-turns'

vi.mock('../telemetry/client', () => ({ track: vi.fn() }))
vi.mock('../telemetry/cohort-classifier', () => ({
  getCohortAtEmit: vi.fn(() => ({ nth_repo_added: 2 }))
}))

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

function oneProjectTask(
  taskKey: string,
  repoId: string,
  worktreeId: string
): SpotlightAgentTaskResolution {
  return {
    taskKey,
    members: [{ repoId, repoName: repoId, worktreeId, taskWorktreeIds: [worktreeId] }],
    skippedRepoNames: []
  }
}

/** Action: AX-1 in back+admin, AX-2 in back. AG: AG-1 in shop, AG-2 in blog. ORCA-1: no Spotlight. */
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
  'back::/wt/ax-2': oneProjectTask('AX-2', 'back', 'back::/wt/ax-2'),
  'shop::/wt/ag-1': oneProjectTask('AG-1', 'shop', 'shop::/wt/ag-1'),
  'blog::/wt/ag-2': oneProjectTask('AG-2', 'blog', 'blog::/wt/ag-2'),
  'orca::/wt/orca-1': { taskKey: 'ORCA-1', members: [], skippedRepoNames: ['orca'] }
}

const LANES: Record<string, string> = {
  'back::/wt/ax-1': 'action',
  'back::/wt/ax-2': 'action',
  'shop::/wt/ag-1': 'ag',
  'blog::/wt/ag-2': 'ag',
  'orca::/wt/orca-1': 'spaceless'
}

const WORK_HOME = '/profiles/work'

const SAVED_WORK: ClaudeManagedAccount = {
  id: 'work',
  email: 'work@example.com',
  managedAuthPath: WORK_HOME,
  authMethod: 'subscription-oauth',
  createdAt: 0,
  updatedAt: 0,
  lastAuthenticatedAt: 0
}

const WORK_SUMMARY: ClaudeManagedAccountSummary = {
  id: 'work',
  email: 'work@example.com',
  authMethod: 'subscription-oauth',
  createdAt: 0,
  updatedAt: 0,
  lastAuthenticatedAt: 0,
  home: WORK_HOME
}

function usage(session: number, weekly = 0): ProviderRateLimits {
  const usageWindow = (usedPercent: number, windowMinutes: number) => ({
    usedPercent,
    windowMinutes,
    resetsAt: null,
    resetDescription: null
  })
  return {
    provider: 'claude',
    session: usageWindow(session, 300),
    weekly: usageWindow(weekly, 10_080),
    updatedAt: 0,
    error: null,
    status: 'ok'
  }
}

function fakeAccounts(
  activeAccountId: string | null,
  limits: { active: ProviderRateLimits | null; inactive: InactiveAccountUsage[] }
) {
  const refresh = vi.fn(async () => {})
  const fetchInactiveClaudeAccountsOnOpen = vi.fn(async () => {})
  return {
    refresh,
    fetchInactiveClaudeAccountsOnOpen,
    limits,
    source: {
      usageRateLimits: () => ({ refresh, fetchInactiveClaudeAccountsOnOpen }),
      getSnapshot: () => ({
        claude: { accounts: [WORK_SUMMARY], activeAccountId },
        rateLimits: { claude: limits.active, inactiveClaudeAccounts: limits.inactive }
      })
    }
  }
}

type SetupOptions = {
  ports?: WorkspacePort[]
  server?: 'running' | 'stopped'
  cap?: number | (() => number)
  /** Each pane's hook rows, read as `readTurnEnd` reads them in the app. */
  rows?: Map<string, SpotlightTurnEndRow[]>
  atLimit?: (paneKey: string) => Promise<boolean>
  notify?: (board: SpotlightAgentStatus) => void
}

function setup(options: SetupOptions = {}) {
  const repos = new Map([
    ['back', makeRepo('back', 8080)],
    ['admin', makeRepo('admin')],
    ['shop', makeRepo('shop')],
    ['blog', makeRepo('blog')],
    ['orca', makeRepo('orca')]
  ])
  const holders = new Map<string, string>()
  let ports = options.ports ?? [
    rootPort('back', 8080),
    rootPort('admin', 3000),
    rootPort('shop', 4000),
    rootPort('blog', 4100)
  ]
  const lightTask = vi.fn(async (worktreeId: string, repoIds: string[]) => {
    for (const member of TASKS[worktreeId].members) {
      if (repoIds.includes(member.repoId)) {
        holders.set(member.repoId, member.worktreeId)
      }
    }
    return repoIds.map((repoId) => ({ repoId, ok: true }))
  })
  const notify = vi.fn<(board: SpotlightAgentStatus) => void>(options.notify ?? (() => {}))
  /** Panes whose terminal closed for good; any other pane keeps or gets one back. */
  const closed = new Set<string>()
  const { rows, cap } = options
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
    readServer: async () => options.server ?? 'running',
    getLane: (worktreeId) => LANES[worktreeId],
    ...(cap === undefined ? {} : { getCap: typeof cap === 'function' ? cap : () => cap }),
    ...(rows
      ? { readTurnEnd: (paneKey: string) => readTurnEndFromRows(rows.get(paneKey) ?? []) }
      : {}),
    ...(options.atLimit ? { paneAccountAtLimit: options.atLimit } : {}),
    isPaneLive: (paneKey) => !closed.has(paneKey),
    notify
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
    notify,
    scanPorts,
    setPorts: (next: WorkspacePort[]) => {
      ports = next
    },
    /** The pane's terminal goes away and nothing takes its key again. */
    closeTerminal: (paneKey: string) => {
      closed.add(paneKey)
      turns.handlePaneGone(paneKey)
    }
  }
}

/** A Claude hook event as the hook server normalizes it, stamped as received now. */
function claudeRow(event: Record<string, unknown>): SpotlightTurnEndRow {
  const normalized = _internals.normalizeHookPayload('claude', buildBody(event), 'production')
  if (!normalized) {
    throw new Error(`the hook server dropped ${String(event.hook_event_name)}`)
  }
  return { ...normalized.payload, receivedAt: Date.now() }
}

/** Feeds `events` through the hook normalizer and tells the turns the pane's newest row. */
async function report(
  turns: SpotlightAgentTurns,
  rows: Map<string, SpotlightTurnEndRow[]>,
  paneKey: string,
  ...events: Record<string, unknown>[]
): Promise<void> {
  vi.advanceTimersByTime(1)
  let row: SpotlightTurnEndRow | null = null
  for (const event of events) {
    row = claudeRow(event)
  }
  if (!row) {
    throw new Error('report needs an event')
  }
  rows.set(paneKey, [row])
  await turns.handleAgentStatuses([
    { paneKey, state: row.state, receivedAt: row.receivedAt, observedInCurrentRuntime: true }
  ])
}

const PROMPT = { hook_event_name: 'UserPromptSubmit', prompt: 'test the checkout' }
const STOP_FAILURE = { hook_event_name: 'StopFailure', error: 'rate_limit' }

beforeEach(() => {
  vi.useFakeTimers()
  _internals.resetCachesForTests()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
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

    await turns.handleAgentStatuses([
      { paneKey: 'p1', state: 'done', receivedAt: requestedAt - 1, observedInCurrentRuntime: true }
    ])
    expect(turns.status().turns).toHaveLength(1)

    await turns.handleAgentStatuses([
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

  it('gives a task with no Spotlight project a turn that only holds a test slot', async () => {
    const { turns, scanPorts, lightTask } = setup({ cap: 1 })

    const result = await turns.on({ paneKey: 'p1', worktreeId: 'orca::/wt/orca-1', scanPorts })

    expect(result).toEqual({
      status: 'on',
      taskKey: 'ORCA-1',
      servers: [],
      skippedRepoNames: ['orca'],
      ready: true,
      note: expect.stringContaining('test slot')
    })
    expect(lightTask).not.toHaveBeenCalled()
    // Why: the footer row still reads `orca · Arrecife`, named by the repo the pane works in.
    expect(turns.status().turns[0].repoNames).toEqual(['orca'])
    const second = turns.on({
      paneKey: 'p2',
      worktreeId: 'shop::/wt/ag-1',
      timeoutMs: 1_000,
      scanPorts
    })
    await vi.advanceTimersByTimeAsync(1_000)
    await expect(second).resolves.toEqual({
      status: 'waiting',
      taskKey: 'AG-1',
      position: 1,
      blockers: [{ taskKey: 'ORCA-1', repoNames: [], holding: true, reason: 'cap' }]
    })
  })
})

describe('SpotlightAgentTurns lanes and limit', () => {
  it('lets one task per space test, and two spaces at once under a limit of two', async () => {
    const { turns, scanPorts } = setup({ cap: 2 })
    await turns.on({ paneKey: 'p1', worktreeId: 'shop::/wt/ag-1', scanPorts })

    const sameSpace = turns.on({
      paneKey: 'p2',
      worktreeId: 'blog::/wt/ag-2',
      timeoutMs: 1_000,
      scanPorts
    })
    await vi.advanceTimersByTimeAsync(1_000)
    await expect(sameSpace).resolves.toEqual({
      status: 'waiting',
      taskKey: 'AG-2',
      position: 1,
      blockers: [{ taskKey: 'AG-1', repoNames: ['shop'], holding: true, reason: 'lane' }]
    })

    await expect(
      turns.on({ paneKey: 'p3', worktreeId: 'back::/wt/ax-2', scanPorts })
    ).resolves.toMatchObject({ status: 'on', taskKey: 'AX-2' })
    const board = turns.status()
    expect(board.cap).toBe(2)
    expect(board.turns.map((turn) => [turn.taskKey, turn.laneKey])).toEqual([
      ['AG-1', 'ag'],
      ['AX-2', 'action']
    ])

    const thirdSpace = turns.on({
      paneKey: 'p4',
      worktreeId: 'orca::/wt/orca-1',
      timeoutMs: 1_000,
      scanPorts
    })
    await vi.advanceTimersByTimeAsync(1_000)
    await expect(thirdSpace).resolves.toMatchObject({
      status: 'waiting',
      taskKey: 'ORCA-1',
      blockers: [
        { taskKey: 'AG-1', reason: 'cap' },
        { taskKey: 'AX-2', reason: 'cap' },
        { taskKey: 'AG-2', reason: 'cap' }
      ]
    })
  })

  it('lets a waiting task in as soon as the limit is raised in Settings, and pushes the board', async () => {
    let cap = 1
    const { turns, scanPorts, notify } = setup({ cap: () => cap })
    await turns.on({ paneKey: 'p1', worktreeId: 'shop::/wt/ag-1', scanPorts })
    const waiting = turns.on({
      paneKey: 'p3',
      worktreeId: 'back::/wt/ax-2',
      timeoutMs: 60_000,
      scanPorts
    })
    await vi.advanceTimersByTimeAsync(0)
    expect(turns.status().waiting.map((row) => row.taskKey)).toEqual(['AX-2'])
    notify.mockClear()

    cap = 2
    turns.capChanged()

    await expect(waiting).resolves.toMatchObject({ status: 'on', taskKey: 'AX-2' })
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ cap: 2 }))
  })
})

describe('SpotlightAgentTurns turn ends', () => {
  it('ends the turn on a plain Stop or a cancellation, but never on a session start', async () => {
    const rows = new Map<string, SpotlightTurnEndRow[]>()
    const { turns, scanPorts } = setup({ rows })
    await turns.on({ paneKey: 'p1', worktreeId: 'shop::/wt/ag-1', scanPorts })

    await report(turns, rows, 'p1', { hook_event_name: 'SessionStart', source: 'startup' })
    expect(turns.status().turns.map((turn) => turn.taskKey)).toEqual(['AG-1'])

    await report(turns, rows, 'p1', PROMPT, { hook_event_name: 'Stop' })
    expect(turns.status().turns).toEqual([])

    await turns.on({ paneKey: 'p1', worktreeId: 'shop::/wt/ag-1', scanPorts })
    await report(turns, rows, 'p1', PROMPT, { hook_event_name: 'Stop', is_interrupt: true })
    expect(turns.status().turns).toEqual([])
  })

  it('pauses a holder cut by its usage limit, keeps its place and gives the turn to the next task', async () => {
    const rows = new Map<string, SpotlightTurnEndRow[]>()
    const { turns, scanPorts } = setup({ cap: 2, rows, atLimit: async () => true })
    await turns.on({ paneKey: 'p1', worktreeId: 'shop::/wt/ag-1', scanPorts })
    const next = turns.on({
      paneKey: 'p2',
      worktreeId: 'blog::/wt/ag-2',
      timeoutMs: 60_000,
      scanPorts
    })
    await vi.advanceTimersByTimeAsync(10)

    await report(turns, rows, 'p1', PROMPT, STOP_FAILURE)

    await expect(next).resolves.toMatchObject({ status: 'on', taskKey: 'AG-2' })
    const board = turns.status()
    expect(board.turns).toMatchObject([{ taskKey: 'AG-2', paneKeys: ['p2'] }])
    expect(board.paused).toMatchObject([
      { paneKey: 'p1', taskKey: 'AG-1', repoNames: ['shop'], laneKey: 'ag', reason: 'limit' }
    ])
    // Why: the killed agent re-publishes its failure; the pause stays as it was.
    await report(turns, rows, 'p1', STOP_FAILURE)
    expect(turns.status().paused).toMatchObject([{ paneKey: 'p1', reason: 'limit' }])

    const again = turns.on({
      paneKey: 'p1',
      worktreeId: 'shop::/wt/ag-1',
      timeoutMs: 60_000,
      scanPorts
    })
    await vi.advanceTimersByTimeAsync(10)
    expect(turns.status().paused).toEqual([])
    turns.off('p2')
    await expect(again).resolves.toMatchObject({ status: 'on', taskKey: 'AG-1' })
  })

  it('calls a failure that is not a usage limit an error', async () => {
    const rows = new Map<string, SpotlightTurnEndRow[]>()
    const { turns, scanPorts } = setup({ rows, atLimit: async () => false })
    await turns.on({ paneKey: 'p1', worktreeId: 'shop::/wt/ag-1', scanPorts })

    await report(turns, rows, 'p1', PROMPT, STOP_FAILURE)

    expect(turns.status().paused).toMatchObject([{ paneKey: 'p1', reason: 'error' }])
  })

  it('reads the usage again before calling a cut a usage limit', async () => {
    const accounts = fakeAccounts('work', { active: usage(97), inactive: [] })
    accounts.refresh.mockImplementation(async () => {
      accounts.limits.active = usage(100)
    })
    const rows = new Map<string, SpotlightTurnEndRow[]>()
    const { turns, scanPorts } = setup({
      rows,
      atLimit: () =>
        isPaneAccountAtLimit({
          transcriptPath: `${WORK_HOME}/projects/-wt-ag-1/session.jsonl`,
          saved: [SAVED_WORK],
          accounts: accounts.source,
          platform: 'darwin'
        })
    })
    await turns.on({ paneKey: 'p1', worktreeId: 'shop::/wt/ag-1', scanPorts })

    await report(turns, rows, 'p1', PROMPT, STOP_FAILURE)

    expect(turns.status().paused).toMatchObject([{ paneKey: 'p1', reason: 'limit' }])
  })
})

describe('SpotlightAgentTurns resuming', () => {
  async function pausedHolder(atLimit = async () => true) {
    const rows = new Map<string, SpotlightTurnEndRow[]>()
    const env = setup({ cap: 2, rows, atLimit })
    await env.turns.on({ paneKey: 'p1', worktreeId: 'shop::/wt/ag-1', scanPorts: env.scanPorts })
    await env.turns.on({ paneKey: 'p2', worktreeId: 'back::/wt/ax-2', scanPorts: env.scanPorts })
    await report(env.turns, rows, 'p1', PROMPT, STOP_FAILURE)
    return { ...env, rows }
  }

  it('keeps a resuming pane paused in its place through the restart and the new session start', async () => {
    const { turns, rows } = await pausedHolder()

    expect(turns.markResuming('p1', { auto: false })).toBe(true)
    expect(turns.status().paused).toMatchObject([{ paneKey: 'p1', resuming: true }])
    turns.handlePaneGone('p1')
    await report(turns, rows, 'p1', { hook_event_name: 'SessionStart', source: 'resume' })
    turns.resumeSettled('p1', { delivered: true })

    expect(turns.status({ paneKey: 'p1' }).mine).toMatchObject({
      kind: 'paused',
      taskKey: 'AG-1',
      position: 1,
      reason: 'limit'
    })
    expect(turns.status().paused?.[0].resuming).toBeUndefined()
  })

  it('ends a resumed pause when the agent finishes without asking for a turn', async () => {
    const { turns, rows } = await pausedHolder()
    turns.markResuming('p1', { auto: false })
    turns.resumeSettled('p1', { delivered: true })

    await report(turns, rows, 'p1', PROMPT, { hook_event_name: 'Stop' })

    expect(turns.status().paused).toEqual([])
    expect(turns.status({ paneKey: 'p1' }).mine).toEqual({ kind: 'none' })
  })

  it("keeps an idle holder's turn through the Esc that interrupts it", async () => {
    const rows = new Map<string, SpotlightTurnEndRow[]>()
    const { turns, scanPorts } = setup({ rows })
    await turns.on({ paneKey: 'p1', worktreeId: 'shop::/wt/ag-1', scanPorts })
    await report(turns, rows, 'p1', PROMPT)

    expect(turns.markResuming('p1', { auto: false })).toBe(true)
    expect(turns.status().turns).toMatchObject([{ taskKey: 'AG-1', resuming: true }])
    await report(turns, rows, 'p1', { hook_event_name: 'Stop', is_interrupt: true })
    turns.resumeSettled('p1', { delivered: true })
    // Why: the next status change re-sends the cancelled row; it is older than the follow-up.
    await turns.handleAgentStatuses([
      {
        paneKey: 'p1',
        state: 'done',
        receivedAt: rows.get('p1')?.[0].receivedAt ?? 0,
        observedInCurrentRuntime: true
      }
    ])
    expect(turns.status().turns).toMatchObject([{ taskKey: 'AG-1', paneKeys: ['p1'] }])

    await report(turns, rows, 'p1', PROMPT, { hook_event_name: 'Stop' })
    expect(turns.status().turns).toEqual([])
  })

  it('closes the window when the follow-up was not delivered, so teardown counts again', async () => {
    const { turns } = await pausedHolder()
    turns.markResuming('p1', { auto: false })

    turns.resumeSettled('p1', { delivered: false })

    expect(turns.status().paused).toMatchObject([{ paneKey: 'p1', reason: 'limit' }])
    expect(turns.status().paused?.[0].resuming).toBeUndefined()
    turns.handlePaneGone('p1')
    expect(turns.status().paused).toEqual([])
  })

  it('closes the window on its own after three minutes', async () => {
    const { turns } = await pausedHolder()
    turns.markResuming('p1', { auto: false })

    await vi.advanceTimersByTimeAsync(3 * 60_000)

    expect(turns.status().paused?.[0].resuming).toBeUndefined()
    turns.handlePaneGone('p1')
    expect(turns.status().paused).toEqual([])
  })

  it('gives back the place or turn of a pane closed during its window once the window ends', async () => {
    const { turns, closeTerminal } = await pausedHolder()
    turns.markResuming('p1', { auto: false })
    turns.markResuming('p2', { auto: false })
    closeTerminal('p1')
    closeTerminal('p2')

    turns.resumeSettled('p1', { delivered: true })
    expect(turns.status().paused).toEqual([])
    expect(turns.status().turns).toMatchObject([{ taskKey: 'AX-2' }])

    await vi.advanceTimersByTimeAsync(3 * 60_000)
    expect(turns.status().turns).toEqual([])
  })

  it('pauses a resumed pane again when its agent fails before asking for a turn', async () => {
    let atLimit = true
    const { turns, rows } = await pausedHolder(async () => atLimit)
    const firstPausedAt = turns.status().paused?.[0].pausedAt ?? 0
    turns.markResuming('p1', { auto: true })
    turns.resumeSettled('p1', { delivered: true })
    atLimit = false

    await report(turns, rows, 'p1', PROMPT, STOP_FAILURE)

    expect(turns.status().paused).toMatchObject([{ paneKey: 'p1', reason: 'error' }])
    expect(turns.status().paused?.[0].pausedAt).toBeGreaterThan(firstPausedAt)
    expect(turns.markResuming('p1', { auto: true })).toBe(true)
  })

  it('keeps a pause as it was on a failure after an undelivered resume or inside the window', async () => {
    const { turns, rows } = await pausedHolder()
    const pausedAt = turns.status().paused?.[0].pausedAt
    turns.markResuming('p1', { auto: false })
    turns.resumeSettled('p1', { delivered: false })
    await report(turns, rows, 'p1', STOP_FAILURE)
    turns.markResuming('p1', { auto: false })
    turns.resumeSettled('p1', { delivered: true })
    turns.markResuming('p1', { auto: false })
    // Why: the second Continuar's restart kills the agent, which re-publishes its failure.
    await report(turns, rows, 'p1', STOP_FAILURE)
    expect(turns.status().paused?.[0].pausedAt).toBe(pausedAt)
  })

  it('counts only delivered automatic resumes, and waits for a click after three in a row', async () => {
    const { turns } = await pausedHolder()
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      expect(turns.markResuming('p1', { auto: true })).toBe(true)
      turns.resumeSettled('p1', { delivered: false })
    }
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      expect(turns.markResuming('p1', { auto: true })).toBe(true)
      turns.resumeSettled('p1', { delivered: true })
      expect(turns.status().paused?.[0].autoResumes).toBe(attempt)
    }

    expect(turns.markResuming('p1', { auto: true })).toBe(false)
    expect(turns.markResuming('p1', { auto: false })).toBe(true)
    expect(turns.markResuming('p1', { auto: false })).toBe(false)
  })

  it('starts the automatic count again after a normal end of the turn', async () => {
    const { turns, rows, scanPorts } = await pausedHolder()
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      turns.markResuming('p1', { auto: true })
      turns.resumeSettled('p1', { delivered: true })
    }
    await report(turns, rows, 'p1', PROMPT, { hook_event_name: 'Stop' })

    await turns.on({ paneKey: 'p1', worktreeId: 'shop::/wt/ag-1', scanPorts })
    await report(turns, rows, 'p1', PROMPT, STOP_FAILURE)
    expect(turns.markResuming('p1', { auto: true })).toBe(true)
  })

  it('never opens a window for a pane with no place', () => {
    const { turns } = setup()

    expect(turns.markResuming('p9', { auto: false })).toBe(false)
  })
})

describe('SpotlightAgentTurns board', () => {
  it('tells each pane where it stands: holding, waiting, paused or nowhere', async () => {
    const rows = new Map<string, SpotlightTurnEndRow[]>()
    const { turns, scanPorts } = setup({ cap: 2, rows, atLimit: async () => false })
    await turns.on({ paneKey: 'p1', worktreeId: 'shop::/wt/ag-1', scanPorts })
    const waiting = turns.on({
      paneKey: 'p2',
      worktreeId: 'blog::/wt/ag-2',
      timeoutMs: 1_000,
      scanPorts
    })
    await vi.advanceTimersByTimeAsync(1_000)
    await waiting
    await turns.on({ paneKey: 'p3', worktreeId: 'back::/wt/ax-2', scanPorts })
    await report(turns, rows, 'p3', PROMPT, STOP_FAILURE)

    expect(turns.status({ paneKey: 'p1' }).mine).toEqual({ kind: 'holding', taskKey: 'AG-1' })
    expect(turns.status({ paneKey: 'p2' }).mine).toEqual({
      kind: 'waiting',
      taskKey: 'AG-2',
      position: 1,
      blockers: [{ taskKey: 'AG-1', repoNames: ['shop'], holding: true, reason: 'lane' }]
    })
    expect(turns.status({ paneKey: 'p3' }).mine).toMatchObject({
      kind: 'paused',
      taskKey: 'AX-2',
      reason: 'error'
    })
    expect(turns.status({ paneKey: 'p9' }).mine).toEqual({ kind: 'none' })
    expect(turns.status().mine).toBeUndefined()
  })

  it("lists a turn's panes in the order they asked, with their last activity", async () => {
    const { turns, scanPorts } = setup()
    await turns.on({ paneKey: 'p1', worktreeId: 'shop::/wt/ag-1', scanPorts })
    vi.advanceTimersByTime(1_000)
    await turns.on({ paneKey: 'p1b', worktreeId: 'shop::/wt/ag-1', scanPorts })
    const workingAt = Date.now() + 5_000
    await turns.handleAgentStatuses([
      { paneKey: 'p1', state: 'working', receivedAt: workingAt, observedInCurrentRuntime: true }
    ])
    turns.noteAgentActivity('p1b', workingAt + 2_000)

    expect(turns.status().turns).toMatchObject([
      { taskKey: 'AG-1', panes: 2, paneKeys: ['p1', 'p1b'], lastActivityAt: workingAt + 2_000 }
    ])
  })

  it('pushes the board on a request, a release, a grant, an auto-release and a pause', async () => {
    const rows = new Map<string, SpotlightTurnEndRow[]>()
    const { turns, scanPorts, notify } = setup({ rows, atLimit: async () => true })
    const lastBoard = (): SpotlightAgentStatus | undefined => notify.mock.lastCall?.[0]

    await turns.on({ paneKey: 'p1', worktreeId: 'back::/wt/ax-1', scanPorts })
    expect(lastBoard()?.turns.map((turn) => turn.taskKey)).toEqual(['AX-1'])

    const waiting = turns.on({
      paneKey: 'p2',
      worktreeId: 'back::/wt/ax-2',
      timeoutMs: 60_000,
      scanPorts
    })
    await vi.advanceTimersByTimeAsync(10)
    expect(lastBoard()?.waiting.map((row) => row.taskKey)).toEqual(['AX-2'])

    turns.off('p1')
    expect(lastBoard()?.turns.map((turn) => turn.taskKey)).toEqual(['AX-2'])
    await waiting

    await report(turns, rows, 'p2', PROMPT, { hook_event_name: 'Stop' })
    expect(lastBoard()?.turns).toEqual([])

    await turns.on({ paneKey: 'p3', worktreeId: 'shop::/wt/ag-1', scanPorts })
    await report(turns, rows, 'p3', PROMPT, STOP_FAILURE)
    expect(lastBoard()?.paused?.map((row) => row.paneKey)).toEqual(['p3'])
  })

  it('gives the turn back even when pushing the board fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { turns, scanPorts } = setup({
      notify: () => {
        throw new Error('window gone')
      }
    })
    await turns.on({ paneKey: 'p1', worktreeId: 'back::/wt/ax-1', scanPorts })

    expect(turns.off('p1').releasedTaskKey).toBe('AX-1')
  })
})

describe('isPaneAccountAtLimit', () => {
  const transcriptPath = `${WORK_HOME}/projects/-wt-ag-1/session.jsonl`

  it('reads an inactive account after fetching it, by its fullest window', async () => {
    const accounts = fakeAccounts(null, { active: usage(10), inactive: [] })
    accounts.fetchInactiveClaudeAccountsOnOpen.mockImplementation(async () => {
      accounts.limits.inactive = [
        { accountId: 'work', rateLimits: usage(40, 100), updatedAt: 0, isFetching: false }
      ]
    })

    await expect(
      isPaneAccountAtLimit({
        transcriptPath,
        saved: [SAVED_WORK],
        accounts: accounts.source,
        platform: 'darwin'
      })
    ).resolves.toBe(true)
  })

  it('is false under 100%, and for a pane whose account it cannot tell', async () => {
    const accounts = fakeAccounts('work', { active: usage(99, 99), inactive: [] })
    const check = (path: string | undefined) =>
      isPaneAccountAtLimit({
        transcriptPath: path,
        saved: [SAVED_WORK],
        accounts: accounts.source,
        platform: 'darwin'
      })

    await expect(check(transcriptPath)).resolves.toBe(false)
    accounts.limits.active = usage(100)
    await expect(check(undefined)).resolves.toBe(false)
    await expect(check('/somewhere/else/projects/-wt/session.jsonl')).resolves.toBe(false)
    await expect(
      isPaneAccountAtLimit({
        transcriptPath,
        saved: [SAVED_WORK],
        accounts: null,
        platform: 'darwin'
      })
    ).resolves.toBe(false)
  })
})

describe('readTurnEndFromRows', () => {
  it('reads the newest finished row of the pane', () => {
    claudeRow(PROMPT)
    const failure = claudeRow(STOP_FAILURE)
    vi.advanceTimersByTime(1)
    const boundary = claudeRow({ hook_event_name: 'SessionStart', source: 'resume' })

    expect(readTurnEndFromRows([failure])).toBe('failure')
    expect(readTurnEndFromRows([failure, boundary])).toBe('boundary')
    expect(readTurnEndFromRows([])).toBe('normal')
  })
})
