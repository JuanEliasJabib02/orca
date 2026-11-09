import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GIT_BLAME_RUNTIME_CAPABILITY } from '../../../shared/protocol-version'
import type { RuntimeGitContext } from './source-control/git/runtime-git-client-context'

const mocks = vi.hoisted(() => ({
  callRuntimeRpc: vi.fn(),
  supportsCapability: vi.fn()
}))

vi.mock('./rpc/calls/runtime-rpc-call', () => ({
  callRuntimeRpc: mocks.callRuntimeRpc
}))
vi.mock('./rpc/compatibility/runtime-capability-proof', () => ({
  runtimeEnvironmentSupportsCapability: mocks.supportsCapability
}))

const { getRuntimeGitLineBlame } = await import('./runtime-git-blame-client')

const REMOTE_CONTEXT: RuntimeGitContext = {
  target: { kind: 'environment', environmentId: 'env-1' },
  worktreeId: 'wt-1',
  worktreePath: '/remote/repo'
}

describe('getRuntimeGitLineBlame capability gate', () => {
  beforeEach(() => {
    mocks.callRuntimeRpc.mockReset()
    mocks.supportsCapability.mockReset()
  })

  it('returns null without calling the RPC when the host does not advertise blame', async () => {
    mocks.supportsCapability.mockResolvedValue(false)

    await expect(
      getRuntimeGitLineBlame(REMOTE_CONTEXT, { filePath: 'src/index.ts', line: 5 })
    ).resolves.toBeNull()

    expect(mocks.supportsCapability).toHaveBeenCalledWith('env-1', GIT_BLAME_RUNTIME_CAPABILITY)
    expect(mocks.callRuntimeRpc).not.toHaveBeenCalled()
  })

  it('calls git.lineBlame once the host advertises the capability', async () => {
    const blame = {
      sha: 'a'.repeat(40),
      author: 'Neil',
      authorTimeMs: 1,
      summary: 's',
      isUncommitted: false
    }
    mocks.supportsCapability.mockResolvedValue(true)
    mocks.callRuntimeRpc.mockResolvedValue(blame)

    await expect(
      getRuntimeGitLineBlame(REMOTE_CONTEXT, { filePath: 'src/index.ts', line: 5 })
    ).resolves.toEqual(blame)

    expect(mocks.callRuntimeRpc).toHaveBeenCalledTimes(1)
    expect(mocks.callRuntimeRpc.mock.calls[0][1]).toBe('git.lineBlame')
  })

  it('never gates the local path on the remote capability', async () => {
    const lineBlame = vi.fn().mockResolvedValue(null)
    ;(
      globalThis as unknown as { window: { api: { git: { lineBlame: typeof lineBlame } } } }
    ).window = { api: { git: { lineBlame } } }

    await expect(
      getRuntimeGitLineBlame(
        {
          target: { kind: 'local' },
          worktreeId: 'wt-1',
          worktreePath: '/repo'
        },
        { filePath: 'src/index.ts', line: 5 }
      )
    ).resolves.toBeNull()

    expect(lineBlame).toHaveBeenCalledTimes(1)
    expect(mocks.supportsCapability).not.toHaveBeenCalled()
    expect(mocks.callRuntimeRpc).not.toHaveBeenCalled()
  })
})
