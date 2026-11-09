import { describe, expect, it } from 'vitest'
import { OrcaRuntimeService } from '../../orca-runtime'
import type { RpcRequest, RpcResponse } from '../core'
import { RpcDispatcher } from '../dispatcher'
import { ALL_RPC_METHODS } from './rpc-method-registry'

// `orca spotlight` and the harness hooks reach Spotlight only through the default registry: a
// method missing from it answers `method_not_found` and the CLI cannot take or give back a turn.
function request(method: string, params: unknown): RpcRequest {
  return { id: `req-${method}`, authToken: 'unused', method, params }
}

function errorOf(response: RpcResponse): { code: string; message: string } | null {
  return response.ok ? null : { code: response.error.code, message: response.error.message }
}

describe('the default RPC registry', () => {
  it.each([
    ['spotlight.on', { worktree: 'id:wt-1', paneKey: 'tab-1:pane-1' }],
    ['spotlight.off', { paneKey: 'tab-1:pane-1' }],
    ['spotlight.status', {}]
  ])('routes %s to its Spotlight handler', async (method, params) => {
    const dispatcher = new RpcDispatcher({
      runtime: new OrcaRuntimeService(),
      methods: ALL_RPC_METHODS
    })

    const error = errorOf(await dispatcher.dispatch(request(method, params)))

    // No window attached Spotlight here, so the handler itself answers, never the dispatcher.
    expect(error?.code).not.toBe('method_not_found')
    expect(error?.message).toBe(
      'Spotlight needs the Orca desktop window; this Orca runs without one.'
    )
  })
})
