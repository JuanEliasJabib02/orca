import { describe, expect, it } from 'vitest'
import type { Worktree } from '../../../../../../shared/worktree/types'
import { MAX_TASK_KEY_LENGTH } from '../../../../store/slices/ui/ui-slice-task-key-record'
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
  it('makes a lone key-less worktree a task named after its branch', () => {
    const lone = make('merchant-doc-agent', `refs/heads/${NAME}`)
    const keys = buildWorktreeTaskKeys([lone])

    expect(keys.getTaskKey(lone)).toBe(NAME)
    expect(keys.getLaneKey(lone)).toBe(`task:${NAME}`)
  })

  it('turns a branch name shared by key-less worktrees in two repos into one task', () => {
    const agent = make('merchant-doc-agent', `refs/heads/${NAME}`)
    const bulk = make('ai-bulk-hours', `refs/heads/${NAME}`)
    const keys = buildWorktreeTaskKeys([agent, bulk])

    expect(keys.getTaskKey(agent)).toBe(NAME)
    expect(keys.getTaskKey(bulk)).toBe(NAME)
  })

  it('merges two worktrees of one repo that share a name', () => {
    const first = make('merchant-doc-agent', `refs/heads/${NAME}`, { id: 'wt-1' })
    const second = make('merchant-doc-agent', `refs/heads/juan/${NAME}`, { id: 'wt-2' })
    const keys = buildWorktreeTaskKeys([first, second])

    expect(keys.getTaskKey(first)).toBe(NAME)
    expect(keys.getTaskKey(second)).toBe(NAME)
  })

  it('keeps unrelated names as separate tasks', () => {
    const agent = make('merchant-doc-agent', 'refs/heads/one-thing')
    const bulk = make('ai-bulk-hours', 'refs/heads/another-thing')
    const keys = buildWorktreeTaskKeys([agent, bulk])

    expect(keys.getTaskKey(agent)).toBe('one-thing')
    expect(keys.getTaskKey(bulk)).toBe('another-thing')
  })

  describe('priority', () => {
    it('keeps a ticket key over the branch name', () => {
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
      const keys = buildWorktreeTaskKeys([keyed, sibling])

      expect(keys.getTaskKey(keyed)).toBe('AX-1')
      expect(keys.getTaskKey(sibling)).toBe(NAME)
    })

    it('does not let a ticketed worktree set the casing of a name task', () => {
      const keyed = make('merchant-doc-agent', 'refs/heads/Merchant-Doc-Cost-Review', {
        displayName: 'AX-7 review'
      })
      const sibling = make('ai-bulk-hours', `refs/heads/${NAME}`)
      const keys = buildWorktreeTaskKeys([keyed, sibling])

      expect(keys.getTaskKey(keyed)).toBe('AX-7')
      expect(keys.getTaskKey(sibling)).toBe(NAME)
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

  describe('display-name fallback', () => {
    it('names a detached HEAD after its display name', () => {
      const detached = make('merchant-doc-agent', '', { displayName: ` ${NAME} ` })
      const named = make('ai-bulk-hours', `refs/heads/${NAME}`)
      const keys = buildWorktreeTaskKeys([detached, named])

      expect(keys.getTaskKey(detached)).toBe(NAME)
      expect(keys.getTaskKey(named)).toBe(NAME)
    })

    it('falls back to the display name when the branch segment cannot be a key', () => {
      const reserved = make('merchant-doc-agent', 'refs/heads/none', { displayName: 'Cleanup' })
      const tooLong = make('ai-bulk-hours', `refs/heads/${'x'.repeat(MAX_TASK_KEY_LENGTH + 1)}`, {
        displayName: 'Refactor'
      })
      const keys = buildWorktreeTaskKeys([reserved, tooLong])

      expect(keys.getTaskKey(reserved)).toBe('Cleanup')
      expect(keys.getTaskKey(tooLong)).toBe('Refactor')
    })

    it('leaves a worktree with no usable branch segment or display name without a task', () => {
      const unnamed = make('merchant-doc-agent', '', { displayName: '  ' })
      const bareRef = make('ai-bulk-hours', 'refs/heads/', { displayName: '' })
      const keys = buildWorktreeTaskKeys([unnamed, bareRef])

      expect(keys.getTaskKey(unnamed)).toBeNull()
      expect(keys.getTaskKey(bareRef)).toBeNull()
      expect(keys.getLaneKey(unnamed)).toBe(NO_TASK_LANE_KEY)
    })
  })

  describe('never a task by name', () => {
    it('skips main worktrees', () => {
      const main = make('merchant-doc-agent', `refs/heads/${NAME}`, { isMainWorktree: true })
      const linked = make('ai-bulk-hours', `refs/heads/${NAME}`)
      const keys = buildWorktreeTaskKeys([main, linked])

      expect(keys.getTaskKey(main)).toBeNull()
      expect(keys.getTaskKey(linked)).toBe(NAME)
    })

    it('skips archived worktrees and does not let them set the casing', () => {
      const archived = make('merchant-doc-agent', 'refs/heads/Merchant-Doc-Cost-Review', {
        isArchived: true
      })
      const live = make('ai-bulk-hours', `refs/heads/${NAME}`)
      const keys = buildWorktreeTaskKeys([archived, live])

      expect(keys.getTaskKey(archived)).toBeNull()
      expect(keys.getTaskKey(live)).toBe(NAME)
    })

    it('skips folder workspaces, which keep only ticket keys', () => {
      const folder = make('folder-workspace:work', '', { id: 'folder:notes', displayName: NAME })
      const ticketed = make('folder-workspace:work', '', {
        id: 'folder:ax',
        displayName: 'AX-12 notes'
      })
      const keys = buildWorktreeTaskKeys([folder, ticketed])

      expect(keys.getTaskKey(folder)).toBeNull()
      expect(keys.getTaskKey(ticketed)).toBe('AX-12')
    })

    it('never forms a task named after the No task lane', () => {
      const first = make('merchant-doc-agent', 'refs/heads/none', { displayName: 'none' })
      const second = make('ai-bulk-hours', 'refs/heads/None', { displayName: 'None' })
      const keys = buildWorktreeTaskKeys([first, second])

      expect(keys.getTaskKey(first)).toBeNull()
      expect(keys.getTaskKey(second)).toBeNull()
    })
  })

  it('resolves a worktree outside the set by its own name, in the set casing when known', () => {
    const upper = make('merchant-doc-agent', 'refs/heads/Merchant-Doc-Cost-Review')
    const keys = buildWorktreeTaskKeys([upper])

    expect(keys.getTaskKey(make('x', `refs/heads/${NAME}`))).toBe('Merchant-Doc-Cost-Review')
    expect(keys.getTaskKey(make('x', 'refs/heads/brand-new'))).toBe('brand-new')
    expect(keys.getTaskKey(make('x', 'refs/heads/ax-3-login'))).toBe('AX-3')
  })
})

describe('TICKET_ONLY_TASK_KEYS', () => {
  it('reads ticket keys and never names a task', () => {
    expect(TICKET_ONLY_TASK_KEYS.getTaskKey(make('a', `refs/heads/${NAME}`))).toBeNull()
    expect(TICKET_ONLY_TASK_KEYS.getLaneKey(make('a', `refs/heads/${NAME}`))).toBe(NO_TASK_LANE_KEY)
    expect(TICKET_ONLY_TASK_KEYS.getTaskKey(make('a', 'refs/heads/feat/ax-3356-login'))).toBe(
      'AX-3356'
    )
  })
})

describe('getSidebarTaskKeys', () => {
  const agent = make('merchant-doc-agent', `refs/heads/${NAME}`)
  const bulk = make('ai-bulk-hours', `refs/heads/${NAME}`)
  const everyWorktree = [agent, bulk]

  it('names tasks over every worktree in task mode and reuses the index per snapshot', () => {
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
    const main = make('ai-bulk-hours', 'refs/heads/main', { isMainWorktree: true })
    const all = [agent, bulk, lone, main]
    const keys = buildWorktreeTaskKeys(all)

    for (const entry of all) {
      expect(getWorktreeTaskKey(entry, all)).toBe(keys.getTaskKey(entry))
    }
    expect(getWorktreeTaskKey(agent, all)).toBe(NAME)
    expect(getWorktreeTaskKey(lone, all)).toBe('lone-work')
    expect(getWorktreeTaskKey(main, all)).toBeNull()
  })
})
