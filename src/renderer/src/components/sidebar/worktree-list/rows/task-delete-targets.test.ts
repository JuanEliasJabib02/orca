import { describe, expect, it } from 'vitest'
import type { Worktree } from '../../../../../../shared/worktree/types'
import { resolveTaskDeleteTargets } from './task-delete-targets'
import { makeTaskWorktree } from './task-spotlight-test-fixtures'

const TASK_KEY = 'AX-3450'

/** A worktree whose branch carries the task's ticket key. */
function makeMember(id: string, repoId: string, overrides: Partial<Worktree> = {}): Worktree {
  return makeTaskWorktree(id, repoId, { branch: 'refs/heads/AX-3450-pos', ...overrides })
}

describe('resolveTaskDeleteTargets', () => {
  it('includes the task worktree of every repo', () => {
    const targets = resolveTaskDeleteTargets(TASK_KEY, [
      makeMember('be-1', 'backend'),
      makeTaskWorktree('be-2', 'backend', { branch: 'refs/heads/AX-1-other' }),
      makeMember('ad-1', 'admin')
    ])

    expect(targets.map((target) => target.id)).toEqual(['be-1', 'ad-1'])
  })

  it('carries the instance and host that the delete flow verifies', () => {
    const targets = resolveTaskDeleteTargets(TASK_KEY, [
      makeMember('be-1', 'backend', { instanceId: 'inst-1', hostId: 'local' })
    ])

    expect(targets).toEqual([{ id: 'be-1', instanceId: 'inst-1', hostId: 'local' }])
  })

  it('includes members that sidebar filters hide', () => {
    // Why: the section only lists visible members; the hidden one still belongs to the task.
    const visible = makeMember('be-1', 'backend')
    const hidden = makeMember('ad-1', 'admin')

    const targets = resolveTaskDeleteTargets(TASK_KEY, [visible, hidden])

    expect(targets.map((target) => target.id)).toEqual(['be-1', 'ad-1'])
  })

  it('includes a hidden member of a task formed by a shared branch name', () => {
    const name = 'merchant-doc-cost-review'
    // Why displayName: the fixture's default (the id, e.g. "be-1") reads as a ticket key.
    const shared = { branch: `refs/heads/${name}`, displayName: name }
    const targets = resolveTaskDeleteTargets(name, [
      makeTaskWorktree('be-1', 'backend', shared),
      makeTaskWorktree('ad-1', 'admin', shared),
      makeTaskWorktree('dc-1', 'docs', { branch: 'refs/heads/unrelated-work', displayName: 'docs' })
    ])

    expect(targets.map((target) => target.id)).toEqual(['be-1', 'ad-1'])
  })

  it('drops main worktrees', () => {
    const targets = resolveTaskDeleteTargets(TASK_KEY, [
      makeMember('be-main', 'backend', { isMainWorktree: true }),
      makeMember('ad-1', 'admin')
    ])

    expect(targets.map((target) => target.id)).toEqual(['ad-1'])
  })

  it('drops archived worktrees', () => {
    const targets = resolveTaskDeleteTargets(TASK_KEY, [
      makeMember('be-1', 'backend', { isArchived: true }),
      makeMember('ad-1', 'admin')
    ])

    expect(targets.map((target) => target.id)).toEqual(['ad-1'])
  })

  it('returns nothing for the "No task" section', () => {
    expect(resolveTaskDeleteTargets(null, [makeMember('be-1', 'backend')])).toEqual([])
  })

  it('returns nothing when every member is a main worktree', () => {
    const targets = resolveTaskDeleteTargets(TASK_KEY, [
      makeMember('be-main', 'backend', { isMainWorktree: true })
    ])

    expect(targets).toEqual([])
  })
})
