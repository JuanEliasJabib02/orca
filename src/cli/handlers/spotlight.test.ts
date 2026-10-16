import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SpotlightAgentOnResult } from '../../shared/spotlight-agent-turn'
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
})
