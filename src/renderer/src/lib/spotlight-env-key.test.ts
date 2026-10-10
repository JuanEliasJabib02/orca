import { describe, expect, it } from 'vitest'
import { MAX_TASK_KEY_LENGTH } from '@/store/slices/ui/ui-slice-task-key-record'
import { getSpotlightEnvKey, toSpotlightEnvKey } from './spotlight-env-key'
import { makeTestWorktree } from './spotlight-terminal-test-store'

const TICKET = makeTestWorktree({
  id: 'admin::/w/ax-3447',
  repoId: 'admin',
  branch: 'refs/heads/juan/AX-3447-checkout',
  displayName: 'checkout'
})
const LONE = makeTestWorktree({
  id: 'admin::/w/lone',
  repoId: 'admin',
  branch: 'refs/heads/lone-fix',
  displayName: 'lone'
})
const MAIN = makeTestWorktree({ id: 'admin::/w/main', repoId: 'admin', isMainWorktree: true })

describe('getSpotlightEnvKey', () => {
  it('is the task key for a worktree in a ticket task', () => {
    expect(getSpotlightEnvKey(TICKET, [TICKET, LONE, MAIN])).toBe('AX-3447')
  })

  it('is the shared branch name for a branch-name task across repos', () => {
    const own = makeTestWorktree({
      id: 'admin::/w/landing',
      repoId: 'admin',
      branch: 'refs/heads/landing-redo'
    })
    const sibling = makeTestWorktree({
      id: 'backend::/w/landing',
      repoId: 'backend',
      branch: 'refs/heads/landing-redo'
    })

    expect(getSpotlightEnvKey(own, [own, sibling])).toBe('landing-redo')
  })

  it('is the branch name for a lone workspace, the task it forms on its own', () => {
    expect(getSpotlightEnvKey(LONE, [TICKET, LONE, MAIN])).toBe('lone-fix')
  })

  it('is the worktree id for a workspace with no usable name', () => {
    const unnamed = makeTestWorktree({
      id: 'admin::/w/x',
      repoId: 'admin',
      branch: '',
      displayName: ''
    })

    expect(getSpotlightEnvKey(unnamed, [TICKET, unnamed, MAIN])).toBe(unnamed.id)
  })

  it('is the worktree id for a main worktree', () => {
    expect(getSpotlightEnvKey(MAIN, [MAIN])).toBe(MAIN.id)
  })

  it('is null for an unnamed workspace whose id is too long to store as a key', () => {
    const long = makeTestWorktree({
      id: `r::/${'x'.repeat(MAX_TASK_KEY_LENGTH)}`,
      repoId: 'r',
      branch: '',
      displayName: ''
    })

    expect(getSpotlightEnvKey(long, [long])).toBeNull()
  })
})

describe('toSpotlightEnvKey', () => {
  it('prefers the task key over the worktree id', () => {
    expect(toSpotlightEnvKey('AX-1', 'wt')).toBe('AX-1')
    expect(toSpotlightEnvKey(null, 'wt')).toBe('wt')
  })

  it('accepts an id of exactly the maximum length', () => {
    const id = 'x'.repeat(MAX_TASK_KEY_LENGTH)

    expect(toSpotlightEnvKey(null, id)).toBe(id)
    expect(toSpotlightEnvKey(null, `${id}x`)).toBeNull()
  })
})
