import {
  SpotlightOffParams,
  SpotlightOnParams
} from '../../../../shared/rpc-contract/spotlight-params'
import {
  getSpotlightAgentTurns,
  type SpotlightAgentTurns
} from '../../../spotlight/spotlight-agent-turns'
import { defineMethod } from '../core'

function requireTurns(): SpotlightAgentTurns {
  const turns = getSpotlightAgentTurns()
  if (!turns) {
    throw new Error('Spotlight needs the Orca desktop window; this Orca runs without one.')
  }
  return turns
}

export const SPOTLIGHT_METHODS = [
  defineMethod({
    name: 'spotlight.on',
    permission: 'workspace',
    params: SpotlightOnParams,
    handler: async (params, { runtime, signal }) =>
      requireTurns().on({
        paneKey: params.paneKey,
        worktreeId: params.worktree,
        timeoutMs: params.timeoutMs,
        signal,
        scanPorts: () => runtime.scanWorkspacePorts()
      })
  }),
  defineMethod({
    name: 'spotlight.off',
    permission: 'workspace',
    params: SpotlightOffParams,
    handler: async (params) => requireTurns().off(params.paneKey)
  }),
  defineMethod({
    name: 'spotlight.status',
    permission: 'workspace',
    params: null,
    handler: async () => requireTurns().status()
  })
]
