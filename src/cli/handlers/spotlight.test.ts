import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  SpotlightAgentOnResult,
  SpotlightAgentStatus
} from '../../shared/spotlight-agent-turn'
import { parseArgs, validateCommandAndFlags } from '../args'
import { dispatch } from '../dispatch'
import { RuntimeClient } from '../runtime-client'
import { SPOTLIGHT_COMMAND_SPECS } from '../specs/spotlight'

const WAITING: SpotlightAgentOnResult = {
  status: 'waiting',
  taskKey: 'AX-2',
  position: 1,
  blockers: [{ taskKey: 'AX-1', repoNames: ['back'], holding: true }]
}

const ON: SpotlightAgentOnResult = {
  status: 'on',
  taskKey: 'AX-2',
  ready: true,
  skippedRepoNames: [],
  servers: [
    {
      repoId: 'back',
      repoName: 'back',
      lit: true,
      port: 8080,
      url: 'http://localhost:8080',
      listening: true,
      server: 'running',
      logPath: '/repos/back/.orca/spotlight.log'
    }
  ]
}

describe('orca spotlight', () => {
  const client = new RuntimeClient('/tmp/orca-spotlight-test', 60_000, null, null)

  function run(args: string[]) {
    const parsed = parseArgs(['spotlight', ...args])
    validateCommandAndFlags(SPOTLIGHT_COMMAND_SPECS, parsed)
    return dispatch(parsed.commandPath, {
      flags: parsed.flags,
      client,
      cwd: '/wt/ax-2',
      json: false
    })
  }

  function reply(result: unknown) {
    return { id: 'spotlight', ok: true as const, result, _meta: { runtimeId: 'test-runtime' } }
  }

  beforeEach(() => {
    vi.stubEnv('ORCA_WORKTREE_ID', 'back::/wt/ax-2')
    vi.stubEnv('ORCA_PANE_KEY', 'tab-1:leaf-1')
    vi.spyOn(console, 'log').mockImplementation(() => {})
    process.exitCode = undefined
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
    process.exitCode = undefined
  })

  it("asks for the turn of this terminal's workspace and widens the client timeout", async () => {
    vi.spyOn(client, 'call').mockResolvedValue(reply(ON))

    await run(['on', '--timeout-ms', '30000'])

    expect(client.call).toHaveBeenCalledExactlyOnceWith(
      'spotlight.on',
      { worktree: 'back::/wt/ax-2', paneKey: 'tab-1:leaf-1', timeoutMs: 30_000 },
      { timeoutMs: 50_000 }
    )
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('back  http://localhost:8080  listening')
    )
    expect(process.exitCode).toBeUndefined()
  })

  it('exits 1 while still waiting so chained tests never run early', async () => {
    vi.spyOn(client, 'call').mockResolvedValue(reply(WAITING))

    await run(['on'])

    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('AX-1 is testing back'))
    expect(process.exitCode).toBe(1)
  })

  it('refuses to run outside an Orca terminal', async () => {
    vi.stubEnv('ORCA_PANE_KEY', '')
    vi.spyOn(client, 'call')

    await expect(run(['off'])).rejects.toThrow('inside the Orca terminal')
    expect(client.call).not.toHaveBeenCalled()
  })

  it('gives the turn back by pane', async () => {
    vi.spyOn(client, 'call').mockResolvedValue(
      reply({ releasedTaskKey: 'AX-2', wasWaiting: false, nextTaskKeys: ['AX-3'] })
    )

    await run(['off'])

    expect(client.call).toHaveBeenCalledExactlyOnceWith('spotlight.off', {
      paneKey: 'tab-1:leaf-1'
    })
    expect(console.log).toHaveBeenCalledWith(
      'Gave back the Spotlight turn of AX-2. AX-3 is testing next.'
    )
  })

  it('prints the note of a turn that holds only a test slot', async () => {
    vi.spyOn(client, 'call').mockResolvedValue(
      reply({
        status: 'on',
        taskKey: 'ORCA-1',
        servers: [],
        skippedRepoNames: [],
        ready: true,
        note: 'No project of ORCA-1 can hold a Spotlight here.'
      } satisfies SpotlightAgentOnResult)
    )

    await run(['on'])

    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('No project of ORCA-1 can hold a Spotlight here.')
    )
    expect(process.exitCode).toBeUndefined()
  })

  it('asks where this terminal stands and prints the limit, its place and who holds it back', async () => {
    const now = Date.now()
    const status: SpotlightAgentStatus = {
      cap: 2,
      turns: [
        { taskKey: 'AG-1', repoNames: ['shop'], panes: 1, grantedAt: now, laneKey: 'ag' },
        { taskKey: 'AX-1', repoNames: ['back'], panes: 1, grantedAt: now, laneKey: 'action' }
      ],
      waiting: [{ taskKey: 'AG-2', repoNames: ['blog'], since: now, paneKey: 'tab-1:leaf-1' }],
      paused: [
        {
          paneKey: 'tab-7:leaf-7',
          taskKey: 'EX-1',
          repoNames: ['expenses'],
          since: now,
          reason: 'limit',
          pausedAt: now
        }
      ],
      lit: [],
      mine: {
        kind: 'waiting',
        taskKey: 'AG-2',
        position: 1,
        blockers: [
          { taskKey: 'AG-1', repoNames: ['shop'], holding: true, reason: 'lane' },
          { taskKey: 'AX-1', repoNames: ['back'], holding: true, reason: 'cap' }
        ]
      }
    }
    vi.spyOn(client, 'call').mockResolvedValue(reply(status))

    await run(['status'])

    expect(client.call).toHaveBeenCalledExactlyOnceWith('spotlight.status', {
      paneKey: 'tab-1:leaf-1'
    })
    const printed = String(vi.mocked(console.log).mock.calls[0][0])
    expect(printed).toContain('Limit: 2 tasks at a time')
    expect(printed).toContain('Paused:\n  EX-1  expenses  (out of usage limit, paused just now)')
    expect(printed).toContain(
      'This terminal: #1 in line for AG-2: AG-1 is testing shop (same space); AX-1 is testing back (limit reached).'
    )
  })

  it('reads the status outside an Orca terminal, without a place of its own', async () => {
    vi.stubEnv('ORCA_PANE_KEY', '')
    const status: SpotlightAgentStatus = { cap: 1, turns: [], waiting: [], lit: [] }
    vi.spyOn(client, 'call').mockResolvedValue(reply(status))

    await run(['status'])

    expect(client.call).toHaveBeenCalledExactlyOnceWith('spotlight.status', {})
    const printed = String(vi.mocked(console.log).mock.calls[0][0])
    expect(printed).toContain('Limit: 1 task at a time')
    expect(printed).not.toContain('This terminal')
  })
})
