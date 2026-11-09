import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GlobalSettings } from '../../shared/global-settings-types'
import { SshHostNotServedError } from '../providers/ssh-host-not-served-error'
import { RuntimeGitCommands } from './integrations/git/orca-runtime-git'
import type { ResolvedRuntimeGitWorktree } from './integrations/git/runtime-git-command-target'

const mocks = vi.hoisted(() => ({
  getLineBlame: vi.fn()
}))

vi.mock('../git/line-blame', () => ({
  getLineBlame: mocks.getLineBlame
}))

const tempDirs: string[] = []

function makeWorktree(path: string): ResolvedRuntimeGitWorktree {
  const worktree = {
    id: 'wt-1',
    repoId: 'repo-1',
    path,
    git: {
      path,
      branch: 'main',
      isBare: false,
      isMainWorktree: false,
      head: 'a'.repeat(40)
    }
  } satisfies Partial<ResolvedRuntimeGitWorktree>
  return worktree as unknown as ResolvedRuntimeGitWorktree
}

describe('RuntimeGitCommands line blame', () => {
  beforeEach(() => {
    mocks.getLineBlame.mockReset()
  })

  afterEach(() => {
    while (tempDirs.length > 0) {
      rmSync(tempDirs.pop()!, { recursive: true, force: true })
    }
  })

  it('blames a local line through the resolved worktree', async () => {
    const worktreePath = mkdtempSync(join(tmpdir(), 'orca-runtime-git-blame-'))
    tempDirs.push(worktreePath)
    const commands = new RuntimeGitCommands({
      resolveRuntimeGitTarget: async () => ({
        worktree: makeWorktree(worktreePath),
        executionHostId: 'local' as const
      }),
      getRuntimeSettings: () => ({}) as GlobalSettings
    })
    const blame = {
      sha: 'a'.repeat(40),
      author: 'Neil',
      authorTimeMs: 1,
      summary: 's',
      isUncommitted: false
    }
    mocks.getLineBlame.mockResolvedValue(blame)

    await expect(commands.getRuntimeGitLineBlame('id:wt-1', 'src/index.ts', 5)).resolves.toEqual(
      blame
    )
    expect(mocks.getLineBlame).toHaveBeenCalledWith(worktreePath, 'src/index.ts', 5, {})
  })

  it('refuses an SSH line blame without running git here', async () => {
    const commands = new RuntimeGitCommands({
      resolveRuntimeGitTarget: async () => ({
        worktree: makeWorktree('/remote/repo'),
        executionHostId: 'ssh:conn-1' as const
      }),
      getRuntimeSettings: () => ({}) as GlobalSettings
    })

    await expect(commands.getRuntimeGitLineBlame('id:wt-1', 'src/index.ts', 5)).rejects.toThrow(
      SshHostNotServedError
    )
    expect(mocks.getLineBlame).not.toHaveBeenCalled()
  })
})
