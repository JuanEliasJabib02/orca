import { describe, expect, it } from 'vitest'
import type { Worktree } from '../../../../../../shared/worktree/types'
import { worktree } from '../../worktree-list-groups-test-fixtures'
import { NO_TASK_LANE_KEY } from './worktree-task-key'
import {
  TICKET_ONLY_TASK_KEYS,
  buildWorktreeTaskKeys,
  getSidebarTaskKeys,
  getTaskKeysForAllWorktrees,
  getWorktreeTaskKey
} from './worktree-task-keys'

function make(repoId: string, branch: string, overrides: Partial<Worktree> = {}): Worktree {
  return {
    ...worktree,
    id: `${repoId}::${branch}`,
    repoId,
    branch,
    displayName: branch,
    ...overrides
  }
}

const NAME = 'merchant-doc-cost-review'

describe('buildWorktreeTaskKeys', () => {
  it('turns a branch name shared by key-less worktrees in two repos into one task', () => {
    const agent = make('merchant-doc-agent', `refs/heads/${NAME}`)
    const bulk = make('ai-bulk-hours', `refs/heads/${NAME}`)
    const keys = buildWorktreeTaskKeys([agent, bulk])

    expect(keys.getTaskKey(agent)).toBe(NAME)
    expect(keys.getTaskKey(bulk)).toBe(NAME)
    expect(keys.getLaneKey(agent)).toBe(`task:${NAME}`)
  })

  it('groups three repos under the same name', () => {
    const all = ['a', 'b', 'c'].map((repoId) => make(repoId, `refs/heads/${NAME}`))
    const keys = buildWorktreeTaskKeys(all)

    expect(all.map((entry) => keys.getTaskKey(entry))).toEqual([NAME, NAME, NAME])
  })

  it('leaves a name used by one repo only in No task, even twice in that repo', () => {
    const first = make('merchant-doc-agent', `refs/heads/${NAME}`, { id: 'wt-1' })
    const second = make('merchant-doc-agent', `refs/heads/juan/${NAME}`, { id: 'wt-2' })
    const keys = buildWorktreeTaskKeys([first, second])

    expect(keys.getTaskKey(first)).toBeNull()
    expect(keys.getTaskKey(second)).toBeNull()
    expect(keys.getLaneKey(first)).toBe(NO_TASK_LANE_KEY)
  })

  it('leaves unrelated key-less branches in No task', () => {
    const agent = make('merchant-doc-agent', 'refs/heads/one-thing')
    const bulk = make('ai-bulk-hours', 'refs/heads/another-thing')
    const keys = buildWorktreeTaskKeys([agent, bulk])

    expect(keys.getTaskKey(agent)).toBeNull()
    expect(keys.getTaskKey(bulk)).toBeNull()
  })

  describe('priority', () => {
    it('keeps a ticket key over a shared branch name', () => {
      const keyed = make('merchant-doc-agent', `refs/heads/${NAME}`, {
        linkedWorkItem: {
          provider: 'jira',
          type: 'issue',
          number: 0,
          title: 'Cost review',
          url: 'https://example.atlassian.net/browse/AX-1',
          jiraIdentifier: 'AX-1'
        }
      })
      const sibling = make('ai-bulk-hours', `refs/heads/${NAME}`)
      const third = make('third-repo', `refs/heads/${NAME}`)
      const keys = buildWorktreeTaskKeys([keyed, sibling, third])

      expect(keys.getTaskKey(keyed)).toBe('AX-1')
      expect(keys.getTaskKey(sibling)).toBe(NAME)
      expect(keys.getTaskKey(third)).toBe(NAME)
    })

    it('does not count a worktree that has a ticket key toward the two repos', () => {
      const keyed = make('merchant-doc-agent', `refs/heads/${NAME}`, { displayName: 'AX-7 review' })
      const sibling = make('ai-bulk-hours', `refs/heads/${NAME}`)
      const keys = buildWorktreeTaskKeys([keyed, sibling])

      expect(keys.getTaskKey(keyed)).toBe('AX-7')
      expect(keys.getTaskKey(sibling)).toBeNull()
    })
  })

  describe('prefix and case tolerance', () => {
    it('matches the last branch segment, so a user prefix does not split the task', () => {
      const prefixed = make('merchant-doc-agent', `refs/heads/juanjabibarcticgrey/${NAME}`)
      const bare = make('ai-bulk-hours', NAME)
      const keys = buildWorktreeTaskKeys([prefixed, bare])

      expect(keys.getTaskKey(prefixed)).toBe(NAME)
      expect(keys.getTaskKey(bare)).toBe(NAME)
    })

    it('compares case-insensitively and uses one casing whatever the worktree order', () => {
      const upper = make('merchant-doc-agent', 'refs/heads/Merchant-Doc-Cost-Review')
      const lower = make('ai-bulk-hours', `refs/heads/${NAME}`)

      for (const order of [
        [upper, lower],
        [lower, upper]
      ]) {
        const keys = buildWorktreeTaskKeys(order)
        expect(keys.getTaskKey(upper)).toBe('Merchant-Doc-Cost-Review')
        expect(keys.getTaskKey(lower)).toBe('Merchant-Doc-Cost-Review')
      }
    })
  })

  describe('never grouped by name', () => {
    it('skips main worktrees', () => {
      const main = make('merchant-doc-agent', `refs/heads/${NAME}`, { isMainWorktree: true })
      const linked = make('ai-bulk-hours', `refs/heads/${NAME}`)
      const keys = buildWorktreeTaskKeys([main, linked])

      expect(keys.getTaskKey(main)).toBeNull()
      expect(keys.getTaskKey(linked)).toBeNull()
    })

    it('ignores archived worktrees when looking for a shared name', () => {
      const archived = make('merchant-doc-agent', `refs/heads/${NAME}`, { isArchived: true })
      const live = make('ai-bulk-hours', `refs/heads/${NAME}`)
      const keys = buildWorktreeTaskKeys([archived, live])

      expect(keys.getTaskKey(live)).toBeNull()
      expect(keys.getTaskKey(archived)).toBeNull()
    })

    it('skips detached HEADs and folder workspaces, which have no branch', () => {
      const detached = make('merchant-doc-agent', '', { displayName: NAME })
      const folder = make('ai-bulk-hours', '', { displayName: NAME, isMainWorktree: true })
      const bareRef = make('third-repo', 'refs/heads/', { displayName: NAME })
      const keys = buildWorktreeTaskKeys([detached, folder, bareRef])

      expect([detached, folder, bareRef].map((entry) => keys.getTaskKey(entry))).toEqual([
        null,
        null,
        null
      ])
    })

    it('never forms a task named after the No task lane', () => {
      const first = make('merchant-doc-agent', 'refs/heads/none')
      const second = make('ai-bulk-hours', 'refs/heads/None')
      const keys = buildWorktreeTaskKeys([first, second])

      expect(keys.getTaskKey(first)).toBeNull()
      expect(keys.getTaskKey(second)).toBeNull()
    })
  })

  it('resolves a worktree outside the set from its own ticket key and the set names', () => {
    const agent = make('merchant-doc-agent', `refs/heads/${NAME}`)
    const bulk = make('ai-bulk-hours', `refs/heads/${NAME}`)
    const keys = buildWorktreeTaskKeys([agent, bulk])

    expect(keys.getTaskKey({ ...agent })).toBe(NAME)
    expect(keys.getTaskKey(make('x', 'refs/heads/ax-3-login'))).toBe('AX-3')
  })
})

describe('TICKET_ONLY_TASK_KEYS', () => {
  it('reads ticket keys and never groups by branch name', () => {
    expect(TICKET_ONLY_TASK_KEYS.getTaskKey(make('a', `refs/heads/${NAME}`))).toBeNull()
    expect(TICKET_ONLY_TASK_KEYS.getTaskKey(make('a', 'refs/heads/feat/ax-3356-login'))).toBe(
      'AX-3356'
    )
  })
})

describe('getSidebarTaskKeys', () => {
  const agent = make('merchant-doc-agent', `refs/heads/${NAME}`)
  const bulk = make('ai-bulk-hours', `refs/heads/${NAME}`)
  const everyWorktree = [agent, bulk]

  it('shares names across every worktree in task mode and reuses the index per snapshot', () => {
    const taskKeys = getSidebarTaskKeys('task', everyWorktree)

    expect(taskKeys.getTaskKey(agent)).toBe(NAME)
    expect(getTaskKeysForAllWorktrees(everyWorktree)).toBe(taskKeys)
  })

  it('reads ticket keys only in the other modes', () => {
    expect(getSidebarTaskKeys('repo', everyWorktree)).toBe(TICKET_ONLY_TASK_KEYS)
  })
})

describe('getWorktreeTaskKey', () => {
  it('answers like the sidebar index for one worktree of a set', () => {
    const agent = make('merchant-doc-agent', `refs/heads/${NAME}`)
    const bulk = make('ai-bulk-hours', `refs/heads/juan/${NAME}`)
    const lone = make('ai-bulk-hours', 'refs/heads/lone-work')
    const all = [agent, bulk, lone]
    const keys = buildWorktreeTaskKeys(all)

    for (const entry of all) {
      expect(getWorktreeTaskKey(entry, all)).toBe(keys.getTaskKey(entry))
    }
    expect(getWorktreeTaskKey(agent, all)).toBe(NAME)
    expect(getWorktreeTaskKey(lone, all)).toBeNull()
  })
})
