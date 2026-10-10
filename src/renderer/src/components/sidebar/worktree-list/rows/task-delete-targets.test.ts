import { describe, expect, it } from 'vitest'
import type { Worktree } from '../../../../../../shared/worktree/types'
import type { SidebarSpaceScope } from '../../sidebar-space-scope'
import { resolveTaskDeleteTargets } from './task-delete-targets'
import { makeTaskWorktree } from './task-spotlight-test-fixtures'

const TASK_KEY = 'AX-3450'

/** A worktree whose branch carries the task's ticket key. */
function makeMember(id: string, repoId: string, overrides: Partial<Worktree> = {}): Worktree {
  return makeTaskWorktree(id, repoId, { branch: 'refs/heads/AX-3450-pos', ...overrides })
}

/** A key-less worktree, so its task is its branch name. */
function makeNamed(id: string, repoId: string, name: string): Worktree {
  // Why displayName: the fixture's default (the id, e.g. "be-1") reads as a ticket key.
  return makeTaskWorktree(id, repoId, { branch: `refs/heads/${name}`, displayName: name })
}

function ids(targets: readonly { id: string }[]): string[] {
  return targets.map((target) => target.id)
}

describe('resolveTaskDeleteTargets', () => {
  it('includes the task worktree of every repo', () => {
    const targets = resolveTaskDeleteTargets(
      TASK_KEY,
      [
        makeMember('be-1', 'backend'),
        makeTaskWorktree('be-2', 'backend', { branch: 'refs/heads/AX-1-other' }),
        makeMember('ad-1', 'admin')
      ],
      null
    )

    expect(ids(targets)).toEqual(['be-1', 'ad-1'])
  })

  it('carries the instance and host that the delete flow verifies', () => {
    const targets = resolveTaskDeleteTargets(
      TASK_KEY,
      [makeMember('be-1', 'backend', { instanceId: 'inst-1', hostId: 'local' })],
      null
    )

    expect(targets).toEqual([{ id: 'be-1', instanceId: 'inst-1', hostId: 'local' }])
  })

  it('includes members that sidebar filters hide', () => {
    // Why: the section only lists visible members; the hidden one still belongs to the task.
    const visible = makeMember('be-1', 'backend')
    const hidden = makeMember('ad-1', 'admin')

    expect(ids(resolveTaskDeleteTargets(TASK_KEY, [visible, hidden], null))).toEqual([
      'be-1',
      'ad-1'
    ])
  })

  it('includes a hidden member of a task formed by a shared branch name', () => {
    const name = 'merchant-doc-cost-review'
    const targets = resolveTaskDeleteTargets(
      name,
      [
        makeNamed('be-1', 'backend', name),
        makeNamed('ad-1', 'admin', name),
        makeNamed('dc-1', 'docs', 'unrelated-work')
      ],
      null
    )

    expect(ids(targets)).toEqual(['be-1', 'ad-1'])
  })

  it('deletes a single named workspace as its own task', () => {
    const targets = resolveTaskDeleteTargets(
      'sidebar',
      [makeNamed('be-1', 'backend', 'sidebar'), makeNamed('be-2', 'backend', 'other')],
      null
    )

    expect(ids(targets)).toEqual(['be-1'])
  })

  describe('in a space', () => {
    const work: SidebarSpaceScope = {
      groupIds: new Set(['work']),
      repoIds: new Set(['backend', 'admin']),
      folderWorkspaceIds: new Set()
    }

    it('never reaches a same-named worktree of another space', () => {
      const all = [
        makeNamed('be-1', 'backend', 'sidebar'),
        makeNamed('ad-1', 'admin', 'Sidebar'),
        makeNamed('home-1', 'personal-repo', 'sidebar')
      ]

      expect(ids(resolveTaskDeleteTargets('Sidebar', all, work))).toEqual(['be-1', 'ad-1'])
      expect(ids(resolveTaskDeleteTargets('Sidebar', all, null))).toEqual([
        'be-1',
        'ad-1',
        'home-1'
      ])
    })

    it('keeps ticket tasks inside the space too', () => {
      const all = [makeMember('be-1', 'backend'), makeMember('home-1', 'personal-repo')]

      expect(ids(resolveTaskDeleteTargets(TASK_KEY, all, work))).toEqual(['be-1'])
    })
  })

  it('drops main worktrees', () => {
    const targets = resolveTaskDeleteTargets(
      TASK_KEY,
      [makeMember('be-main', 'backend', { isMainWorktree: true }), makeMember('ad-1', 'admin')],
      null
    )

    expect(ids(targets)).toEqual(['ad-1'])
  })

  it('drops archived worktrees', () => {
    const targets = resolveTaskDeleteTargets(
      TASK_KEY,
      [makeMember('be-1', 'backend', { isArchived: true }), makeMember('ad-1', 'admin')],
      null
    )

    expect(ids(targets)).toEqual(['ad-1'])
  })

  it('returns nothing for a section without a task key', () => {
    expect(resolveTaskDeleteTargets(null, [makeMember('be-1', 'backend')], null)).toEqual([])
  })

  it('returns nothing when every member is a main worktree', () => {
    const targets = resolveTaskDeleteTargets(
      TASK_KEY,
      [makeMember('be-main', 'backend', { isMainWorktree: true })],
      null
    )

    expect(targets).toEqual([])
  })
})
