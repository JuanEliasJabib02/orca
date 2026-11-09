import { describe, expect, it, vi } from 'vitest'
import { makeRequest, repoDispatcher } from './repo-rpc.test-fixture'

describe('repo.update Spotlight server config', () => {
  it('sanitizes Spotlight server configs and keeps null as the clear sentinel', async () => {
    const updateRepo = vi.fn().mockResolvedValue({ id: 'repo-1', path: '/srv/repo' })
    const dispatcher = repoDispatcher({ getRuntimeId: () => 'test-runtime', updateRepo })

    await dispatcher.dispatch(
      makeRequest('repo.update', {
        repo: 'repo-1',
        updates: { spotlightServer: { dev: ' pnpm dev ', prod: '', port: 3001, extra: 1 } }
      })
    )
    expect(updateRepo).toHaveBeenLastCalledWith('repo-1', {
      spotlightServer: { dev: 'pnpm dev', port: 3001 }
    })

    await dispatcher.dispatch(
      makeRequest('repo.update', { repo: 'repo-1', updates: { spotlightServer: null } })
    )
    expect(updateRepo).toHaveBeenLastCalledWith('repo-1', { spotlightServer: null })

    await dispatcher.dispatch(
      makeRequest('repo.update', { repo: 'repo-1', updates: { spotlightServer: { port: 0 } } })
    )
    expect(updateRepo).toHaveBeenLastCalledWith('repo-1', { spotlightServer: null })

    // Older clients never send the field, and malformed input must not clear anything.
    await dispatcher.dispatch(
      makeRequest('repo.update', { repo: 'repo-1', updates: { displayName: 'Renamed' } })
    )
    expect(updateRepo).toHaveBeenLastCalledWith('repo-1', { displayName: 'Renamed' })
    await dispatcher.dispatch(
      makeRequest('repo.update', { repo: 'repo-1', updates: { spotlightServer: 'pnpm dev' } })
    )
    expect(updateRepo).toHaveBeenLastCalledWith('repo-1', {})
  })
})
