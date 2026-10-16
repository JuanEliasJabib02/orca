import { describe, expect, it } from 'vitest'
import type { Worktree } from '../../../shared/worktree/types'
import {
  makeSpotlightRepo,
  makeTaskWorktree
} from '@/components/sidebar/worktree-list/rows/task-spotlight-test-fixtures'
import { resolveAgentSpotlightTask } from './spotlight-agent-task-requests'

const BACKEND = makeSpotlightRepo('backend')
const ADMIN = makeSpotlightRepo('admin')
const LANDING = makeSpotlightRepo('landing', { spotlightTestingEnabled: false })

function onBranch(id: string, repoId: string, branch: string, lastActivityAt = 0): Worktree {
  return makeTaskWorktree(id, repoId, { branch: `refs/heads/${branch}`, lastActivityAt })
}

function resolve(worktreeId: string, worktrees: Worktree[]) {
  const worktreesByRepo: Record<string, Worktree[]> = {}
  for (const worktree of worktrees) {
    ;(worktreesByRepo[worktree.repoId] ??= []).push(worktree)
  }
  return resolveAgentSpotlightTask({
    worktreeId,
    allWorktrees: worktrees,
    worktreesByRepo,
    repos: [BACKEND, ADMIN, LANDING]
  })
}

describe('resolveAgentSpotlightTask', () => {
  it("takes the caller's task across projects and leaves other tasks and roots out", () => {
    const task = resolve('be-login', [
      onBranch('be-login', 'backend', 'juan/login-fix'),
      onBranch('ad-login', 'admin', 'juan/login-fix'),
      onBranch('ad-other', 'admin', 'juan/other-task'),
      makeTaskWorktree('be-root', 'backend', { isMainWorktree: true, branch: 'refs/heads/main' })
    ])

    expect('error' in task).toBe(false)
    if ('error' in task) {
      return
    }
    expect(task.taskKey).toBe('login-fix')
    expect(task.members.map((member) => [member.repo.id, member.worktree.id])).toEqual([
      ['backend', 'be-login'],
      ['admin', 'ad-login']
    ])
  })

  it("puts the caller's own worktree on its project even when the task has a newer one there", () => {
    const task = resolve('be-mine', [
      onBranch('be-mine', 'backend', 'juan/login-fix', 10),
      onBranch('be-newer', 'backend', 'ana/login-fix', 99)
    ])

    expect('error' in task ? task.error : task.members[0].worktree.id).toBe('be-mine')
  })

  it('reports projects whose Spotlight setting is off', () => {
    const task = resolve('be-login', [
      onBranch('be-login', 'backend', 'juan/login-fix'),
      onBranch('la-login', 'landing', 'juan/login-fix')
    ])

    expect('error' in task ? [] : task.spotlightOffRepos.map((repo) => repo.id)).toEqual([
      'landing'
    ])
  })

  it('refuses an unknown workspace and a project root', () => {
    const root = makeTaskWorktree('be-root', 'backend', {
      isMainWorktree: true,
      branch: 'refs/heads/main'
    })

    expect(resolve('missing', [root])).toMatchObject({ error: expect.any(String) })
    expect(resolve('be-root', [root])).toMatchObject({ error: expect.any(String) })
  })
})
