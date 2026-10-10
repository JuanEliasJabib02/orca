import { describe, expect, it } from 'vitest'
import type { Worktree } from '../../../../../../shared/worktree/types'
import type { SidebarSpaceScope } from '../../sidebar-space-scope'
import { hasTaskWorktreesBesides, resolveTaskDeleteTargets } from './task-delete-targets'
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

function toDeleteIdentities(worktrees: readonly Worktree[]) {
  return worktrees.map(({ id, instanceId, hostId }) => ({ id, instanceId, hostId }))
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

  it('leaves a provisioned VM root out, which is deleted through its own flow', () => {
    const vmRoot = makeTaskWorktree('vm-1', 'vm-repo', {
      branch: 'refs/heads/sidebar',
      displayName: 'sidebar',
      isMainWorktree: true,
      ephemeralVmCheckoutMode: 'provisioned-root'
    })
    const all = [makeNamed('be-1', 'backend', 'sidebar'), vmRoot]

    expect(ids(resolveTaskDeleteTargets('sidebar', all, null))).toEqual(['be-1'])
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

describe('hasTaskWorktreesBesides', () => {
  it('is false once the deleted worktrees were the whole task', () => {
    const all = [makeNamed('be-1', 'backend', 'sidebar'), makeNamed('ad-1', 'admin', 'sidebar')]

    expect(hasTaskWorktreesBesides('sidebar', all, toDeleteIdentities(all))).toBe(false)
  })

  it('is true while a worktree of the task is outside the deleted ones, in any space', () => {
    const inSpace = makeNamed('be-1', 'backend', 'sidebar')
    const elsewhere = makeNamed('home-1', 'personal-repo', 'sidebar')

    expect(hasTaskWorktreesBesides('sidebar', [inSpace, elsewhere], [inSpace])).toBe(true)
  })

  it('tells the same id apart across hosts', () => {
    const local = makeNamed('be-1', 'backend', 'sidebar')
    const remote = makeTaskWorktree('be-1', 'backend', {
      branch: 'refs/heads/sidebar',
      displayName: 'sidebar',
      hostId: 'ssh:box'
    })

    expect(hasTaskWorktreesBesides('sidebar', [local, remote], [local])).toBe(true)
    expect(hasTaskWorktreesBesides('sidebar', [local, remote], [local, remote])).toBe(false)
  })

  it('counts a provisioned VM root of the task, which the delete never removes', () => {
    const target = makeNamed('be-1', 'backend', 'sidebar')
    const vmRoot = makeTaskWorktree('vm-1', 'vm-repo', {
      branch: 'refs/heads/sidebar',
      displayName: 'sidebar',
      isMainWorktree: true,
      ephemeralVmCheckoutMode: 'provisioned-root'
    })

    expect(hasTaskWorktreesBesides('sidebar', [target, vmRoot], [target])).toBe(true)
    expect(
      hasTaskWorktreesBesides('sidebar', [target, vmRoot], toDeleteIdentities([target, vmRoot]))
    ).toBe(false)
    expect(
      hasTaskWorktreesBesides('sidebar', [target, { ...vmRoot, isArchived: true }], [target])
    ).toBe(false)
  })

  it('ignores archived and main worktrees, which are never part of the delete', () => {
    const target = makeNamed('be-1', 'backend', 'sidebar')
    const archived = makeTaskWorktree('be-2', 'backend', {
      branch: 'refs/heads/sidebar',
      displayName: 'sidebar',
      isArchived: true
    })
    const main = makeTaskWorktree('be-main', 'backend', {
      branch: 'refs/heads/sidebar',
      displayName: 'sidebar',
      isMainWorktree: true
    })

    expect(hasTaskWorktreesBesides('sidebar', [target, archived, main], [target])).toBe(false)
  })
})
