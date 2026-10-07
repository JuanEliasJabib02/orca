import { describe, expect, it } from 'vitest'
import type { TaskSectionInfo } from '../grouping/row-types'
import { resolveTaskDeleteTargets } from './task-delete-targets'
import { makeTaskWorktree } from './task-spotlight-test-fixtures'

function makeTask(worktrees: TaskSectionInfo['worktrees']): TaskSectionInfo {
  return { taskKey: 'AX-3450', title: null, worktrees, folderWorkspaceIds: [] }
}

describe('resolveTaskDeleteTargets', () => {
  it('includes the task worktree of every repo', () => {
    const task = makeTask([
      { worktreeId: 'be-1', repoId: 'backend' },
      { worktreeId: 'ad-1', repoId: 'admin' }
    ])

    const targets = resolveTaskDeleteTargets(task, {
      backend: [makeTaskWorktree('be-1', 'backend'), makeTaskWorktree('be-2', 'backend')],
      admin: [makeTaskWorktree('ad-1', 'admin')]
    })

    expect(targets.map((target) => target.id)).toEqual(['be-1', 'ad-1'])
  })

  it('carries the instance and host that the delete flow verifies', () => {
    const task = makeTask([{ worktreeId: 'be-1', repoId: 'backend' }])

    const targets = resolveTaskDeleteTargets(task, {
      backend: [makeTaskWorktree('be-1', 'backend', { instanceId: 'inst-1', hostId: 'local' })]
    })

    expect(targets).toEqual([{ id: 'be-1', instanceId: 'inst-1', hostId: 'local' }])
  })

  it('drops main worktrees', () => {
    const task = makeTask([
      { worktreeId: 'be-main', repoId: 'backend' },
      { worktreeId: 'ad-1', repoId: 'admin' }
    ])

    const targets = resolveTaskDeleteTargets(task, {
      backend: [makeTaskWorktree('be-main', 'backend', { isMainWorktree: true })],
      admin: [makeTaskWorktree('ad-1', 'admin')]
    })

    expect(targets.map((target) => target.id)).toEqual(['ad-1'])
  })

  it('drops ids and repos that are not in the store', () => {
    const task = makeTask([
      { worktreeId: 'be-gone', repoId: 'backend' },
      { worktreeId: 'dc-1', repoId: 'docs' },
      { worktreeId: 'ad-1', repoId: 'admin' }
    ])

    const targets = resolveTaskDeleteTargets(task, {
      backend: [makeTaskWorktree('be-other', 'backend')],
      admin: [makeTaskWorktree('ad-1', 'admin')]
    })

    expect(targets.map((target) => target.id)).toEqual(['ad-1'])
  })

  it('leaves folder workspaces out', () => {
    const task: TaskSectionInfo = {
      ...makeTask([{ worktreeId: 'be-1', repoId: 'backend' }]),
      folderWorkspaceIds: ['folder-1']
    }

    const targets = resolveTaskDeleteTargets(task, {
      backend: [makeTaskWorktree('be-1', 'backend')]
    })

    expect(targets.map((target) => target.id)).toEqual(['be-1'])
  })

  it('returns nothing when every member is a main worktree', () => {
    const task = makeTask([{ worktreeId: 'be-main', repoId: 'backend' }])

    const targets = resolveTaskDeleteTargets(task, {
      backend: [makeTaskWorktree('be-main', 'backend', { isMainWorktree: true })]
    })

    expect(targets).toEqual([])
  })
})
