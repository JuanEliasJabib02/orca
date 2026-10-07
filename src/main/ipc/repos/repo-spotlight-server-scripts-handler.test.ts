import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Repo } from '../../../shared/repo-types'

const { detectMock } = vi.hoisted(() => ({ detectMock: vi.fn() }))

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }))
vi.mock('../../spotlight/spotlight-server-script-detection', () => ({
  detectSpotlightServerScripts: detectMock
}))

import { detectSpotlightServerScriptsForRepo } from './repo-spotlight-server-scripts-handler'

const DETECTION = { detected: { dev: 'pnpm dev' }, scriptCommands: ['pnpm dev'] }

function makeStore(repo: Partial<Repo> | undefined): { getRepo: (id: string) => Repo | undefined } {
  const full: Repo | undefined = repo && {
    id: 'repo-1',
    path: '/work/app',
    displayName: 'app',
    badgeColor: '#000',
    addedAt: 0,
    ...repo
  }
  return { getRepo: (id) => (full && id === full.id ? full : undefined) }
}

describe('detectSpotlightServerScriptsForRepo', () => {
  beforeEach(() => {
    detectMock.mockReset()
    detectMock.mockResolvedValue(DETECTION)
  })

  it('detects from the root path of a local git repo', async () => {
    await expect(detectSpotlightServerScriptsForRepo(makeStore({}), 'repo-1')).resolves.toEqual(
      DETECTION
    )
    expect(detectMock).toHaveBeenCalledWith('/work/app')
  })

  it.each([
    ['an unknown repo', undefined, 'repo-1'],
    ['a non-string id', {}, 42],
    ['a folder repo', { kind: 'folder' as const }, 'repo-1'],
    ['an SSH repo', { connectionId: 'ssh-1' }, 'repo-1']
  ])('returns an empty result for %s', async (_label, repo, repoId) => {
    await expect(detectSpotlightServerScriptsForRepo(makeStore(repo), repoId)).resolves.toEqual({
      detected: {},
      scriptCommands: []
    })
    expect(detectMock).not.toHaveBeenCalled()
  })
})
