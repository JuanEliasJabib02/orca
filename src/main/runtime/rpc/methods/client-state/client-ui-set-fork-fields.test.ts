import '../../unused-default-rpc-methods.test-fixture'
import { describe, expect, it, vi } from 'vitest'
import { getDefaultUIState } from '../../../../../shared/constants'
import type { OrcaRuntimeService } from '../../../orca-runtime'
import type { RpcRequest } from '../../core'
import { RpcDispatcher } from '../../dispatcher'
import { CLIENT_UI_METHODS } from './client-ui'

function makeRequest(method: string, params?: unknown): RpcRequest {
  return { id: 'req-1', authToken: 'tok', method, params }
}

// Why a fork-owned file: these fields belong to Orca Pro Max (spaces, Group by Task, Spotlight,
// task notes); one row per key so a schema drift on any of them fails on its own name.
describe('ui.set fork fields', () => {
  it.each([
    ['activeSidebarSpaceGroupId', { activeSidebarSpaceGroupId: 'group-1' }],
    ['activeSidebarSpaceGroupId null', { activeSidebarSpaceGroupId: null }],
    [
      'composerCompanionRepoIdsByRepoId',
      { composerCompanionRepoIdsByRepoId: { experience: ['backend', 'admin'] } }
    ],
    ['groupBy task', { groupBy: 'task' }],
    ['groupByBySpaceId', { groupByBySpaceId: { 'group-1': 'task', 'group-2': 'repo' } }],
    ['spotlightEnvByTaskKey', { spotlightEnvByTaskKey: { 'AX-3447': 'dev', 'AX-3500': 'prod' } }],
    [
      'spotlightVariantByTaskRepo',
      { spotlightVariantByTaskRepo: { 'AX-3447::landing': 'do', 'AX-3500::landing': 'pt' } }
    ],
    ['taskNoteByTaskKey', { taskNoteByTaskKey: { 'AX-3447': 'POS Action Wear' } }]
  ])('accepts %s, which the renderer persists through ui.set', async (_label, payload) => {
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: ui.set reads only these members.
    const runtime = {
      getRuntimeId: () => 'test-runtime',
      updateUIState: vi.fn(() => getDefaultUIState())
    } as unknown as OrcaRuntimeService
    const dispatcher = new RpcDispatcher({ runtime, methods: CLIENT_UI_METHODS })

    const response = await dispatcher.dispatch(makeRequest('ui.set', payload))

    expect(response).toMatchObject({ ok: true })
    expect(runtime.updateUIState).toHaveBeenCalledWith(payload)
  })
})
