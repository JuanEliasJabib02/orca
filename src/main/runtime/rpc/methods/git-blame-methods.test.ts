import '../unused-default-rpc-methods.test-fixture'
import { describe, expect, it, vi } from 'vitest'
import { RpcDispatcher } from '../dispatcher'
import type { RpcRequest } from '../core'
import type { OrcaRuntimeService } from '../../orca-runtime'
import {
  GIT_BLAME_RUNTIME_CAPABILITY,
  MIN_COMPATIBLE_RUNTIME_CLIENT_VERSION,
  RUNTIME_CAPABILITIES,
  RUNTIME_PROTOCOL_VERSION
} from '../../../../shared/protocol-version'
import { GIT_METHODS } from './source-control/git/git'

function makeRequest(method: string, params?: unknown): RpcRequest {
  return { id: 'req-1', authToken: 'tok', method, params }
}

const BLAME = {
  sha: 'a'.repeat(40),
  author: 'Neil',
  authorTimeMs: 1_777_664_339_000,
  summary: 'docs: update readme',
  isUncommitted: false
}

describe('git blame RPC methods', () => {
  it('returns a single-line blame for a selected worktree', async () => {
    const runtime = {
      getRuntimeId: () => 'test-runtime',
      getRuntimeGitLineBlame: vi.fn().mockResolvedValue(BLAME)
    } as unknown as OrcaRuntimeService
    const dispatcher = new RpcDispatcher({ runtime, methods: GIT_METHODS })

    const response = await dispatcher.dispatch(
      makeRequest('git.lineBlame', { worktree: 'id:wt-1', filePath: 'src/index.ts', line: 5 })
    )

    expect(runtime.getRuntimeGitLineBlame).toHaveBeenCalledWith('id:wt-1', 'src/index.ts', 5)
    expect(response).toMatchObject({ ok: true, result: BLAME })
  })

  it('returns a whole-file blame for a selected worktree', async () => {
    const runtime = {
      getRuntimeId: () => 'test-runtime',
      getRuntimeGitFileBlame: vi.fn().mockResolvedValue({ 5: BLAME })
    } as unknown as OrcaRuntimeService
    const dispatcher = new RpcDispatcher({ runtime, methods: GIT_METHODS })

    const response = await dispatcher.dispatch(
      makeRequest('git.fileBlame', { worktree: 'id:wt-1', filePath: 'src/index.ts' })
    )

    expect(runtime.getRuntimeGitFileBlame).toHaveBeenCalledWith('id:wt-1', 'src/index.ts')
    expect(response).toMatchObject({ ok: true, result: { 5: BLAME } })
  })

  it('advertises line blame without moving the mixed-version protocol fence', () => {
    expect(RUNTIME_PROTOCOL_VERSION).toBe(3)
    expect(MIN_COMPATIBLE_RUNTIME_CLIENT_VERSION).toBe(2)
    expect(RUNTIME_CAPABILITIES).toContain(GIT_BLAME_RUNTIME_CAPABILITY)
  })
})
