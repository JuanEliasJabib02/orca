import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'
import type { Store } from '../../persistence/loading-store/store'
import { repoTarget } from '../../persistence/repo-host-target-matcher.test-fixture'

const { handlers } = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, args: unknown) => unknown>()
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (event: unknown, args: unknown) => unknown) => {
      handlers.set(channel, handler)
    }
  }
}))
vi.mock('./repos-changed-notification', () => ({ notifyReposChanged: vi.fn() }))
vi.mock('../worktrees/removal/registered-worktree-roots-cache', () => ({
  invalidateAuthorizedRootsCache: vi.fn()
}))
vi.mock('../../workspaces/creation/worktree-root-preparation', () => ({
  prepareLocalWorktreeRootForRepo: vi.fn()
}))

import { registerRepoUpdateHandler } from './repo-update-handler'

const repo = {
  id: 'repo-spotlight-server',
  path: '/tmp/repo-spotlight-server',
  displayName: 'repo-spotlight-server',
  kind: 'git' as const,
  badgeColor: '#22c55e',
  addedAt: 0
}

// Why a fork-owned file: per-repo Spotlight server commands are an Orca Pro Max feature.
describe('repos:update Spotlight server config', () => {
  const store = {
    getRepo: vi.fn(() => repo),
    getRepos: vi.fn(() => [repo]),
    updateRepo: vi.fn(() => repo)
  }

  beforeEach(() => {
    handlers.clear()
    store.updateRepo.mockClear()
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: repos:update reads only these store members for a non-kind update.
    registerRepoUpdateHandler({} as BrowserWindow, store as unknown as Store)
  })

  function update(spotlightServer: unknown): unknown {
    const handler = handlers.get('repos:update')
    if (!handler) {
      throw new Error('repos:update handler not registered')
    }
    return handler(null, { repoId: repo.id, updates: { spotlightServer } })
  }

  it('sanitizes Spotlight server configs through local repos:update', async () => {
    await update({ local: ' pnpm local ', dev: 7, port: 3002, extra: true })
    expect(store.updateRepo).toHaveBeenLastCalledWith(repoTarget(repo.id), {
      spotlightServer: { local: 'pnpm local', port: 3002 }
    })

    await update({ dev: '   ', port: 70000 })
    expect(store.updateRepo).toHaveBeenLastCalledWith(repoTarget(repo.id), {
      spotlightServer: null
    })

    await update(null)
    expect(store.updateRepo).toHaveBeenLastCalledWith(repoTarget(repo.id), {
      spotlightServer: null
    })

    await update('pnpm dev')
    expect(store.updateRepo).toHaveBeenLastCalledWith(repoTarget(repo.id), {})
  })
})
