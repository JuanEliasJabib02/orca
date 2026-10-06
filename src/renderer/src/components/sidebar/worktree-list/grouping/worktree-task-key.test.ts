import { describe, expect, it } from 'vitest'
import type { WorkspaceLinkedItem } from '../../../../../../shared/worktree/types'
import {
  NO_TASK_LANE_KEY,
  findTaskKey,
  getFolderWorkspaceTaskLaneKey,
  getTaskKey,
  getTaskKeyFromLaneKey,
  getTaskLaneKey,
  getTaskTitle
} from './worktree-task-key'

function jiraItem(jiraIdentifier: string, title = 'Fix the thing'): WorkspaceLinkedItem {
  return {
    provider: 'jira',
    type: 'issue',
    number: 0,
    title,
    url: `https://example.atlassian.net/browse/${jiraIdentifier}`,
    jiraIdentifier
  }
}

describe('findTaskKey', () => {
  it.each([
    ['AX-3356', 'AX-3356'],
    ['Ax 3356', 'AX-3356'],
    ['ax_3356', 'AX-3356'],
    ['ax3356', 'AX-3356'],
    ['vue3', null],
    ['md5', null],
    ['feat/ax-3356-foo', 'AX-3356'],
    ['Fix login (AX-3356)', 'AX-3356'],
    ['ab2-123 follow-up', 'AB2-123']
  ])('reads %s as %s', (text, expected) => {
    expect(findTaskKey(text)).toBe(expected)
  })

  it('takes the first key when a name carries several', () => {
    expect(findTaskKey('ax-1-and-ax-2')).toBe('AX-1')
  })

  // The 2–6 char prefix is deliberate: a longer leading word must not pass for a project key.
  it.each(['release-2024', 'hotfixes-12', 'feature/super-critical', 'a-123', 'v2'])(
    'finds no key in %s',
    (text) => {
      expect(findTaskKey(text)).toBeNull()
    }
  )

  it('needs token boundaries on both sides', () => {
    expect(findTaskKey('releaseax-3356')).toBeNull()
    expect(findTaskKey('ax-3356b')).toBeNull()
  })
})

describe('getTaskKey', () => {
  it('prefers the linked Jira item over the branch and display name', () => {
    expect(
      getTaskKey({
        linkedWorkItem: jiraItem('ax-3448'),
        branch: 'refs/heads/juan/ax-1-other',
        displayName: 'AX-2'
      })
    ).toBe('AX-3448')
  })

  it('keeps a linked Jira id whose project key is longer than free text allows', () => {
    expect(getTaskKey({ linkedWorkItem: jiraItem('PLATFORM-12'), displayName: 'x' })).toBe(
      'PLATFORM-12'
    )
  })

  it('ignores non-Jira links and falls back to the branch', () => {
    const githubIssue: WorkspaceLinkedItem = {
      provider: 'github',
      type: 'issue',
      number: 7,
      title: 'GitHub issue',
      url: 'https://github.com/o/r/issues/7'
    }
    expect(
      getTaskKey({
        linkedWorkItem: githubIssue,
        branch: 'refs/heads/feat/ax-3356-login',
        displayName: 'login'
      })
    ).toBe('AX-3356')
  })

  it('reads the last branch segment before leading user or type segments', () => {
    expect(getTaskKey({ branch: 'team-1/ax-3356', displayName: 'x' })).toBe('AX-3356')
  })

  it('falls back to the display name when the branch has no key', () => {
    expect(getTaskKey({ branch: 'refs/heads/main', displayName: 'Ax 3356 review' })).toBe('AX-3356')
  })

  it('returns null when nothing carries a key', () => {
    expect(getTaskKey({ branch: 'refs/heads/main', displayName: 'main' })).toBeNull()
  })

  it('reads folder workspaces from the linked task, then the name', () => {
    expect(getFolderWorkspaceTaskLaneKey({ linkedTask: null, name: 'ax_77 notes' })).toBe(
      'task:AX-77'
    )
    expect(
      getFolderWorkspaceTaskLaneKey({ linkedTask: jiraItem('AX-9'), name: 'ax_77 notes' })
    ).toBe('task:AX-9')
    expect(getFolderWorkspaceTaskLaneKey({ linkedTask: null, name: 'Scratch' })).toBe(
      NO_TASK_LANE_KEY
    )
  })
})

describe('getTaskTitle', () => {
  it('uses the linked Jira title only for the key it carries', () => {
    const source = { linkedWorkItem: jiraItem('AX-3448', ' Login flow '), displayName: 'x' }
    expect(getTaskTitle(source, 'AX-3448')).toBe('Login flow')
    expect(getTaskTitle(source, 'AX-1')).toBeNull()
    expect(getTaskTitle({ displayName: 'AX-3448' }, 'AX-3448')).toBeNull()
  })
})

describe('task lane keys', () => {
  it('round-trips a key and maps no key to the No task lane', () => {
    expect(getTaskKeyFromLaneKey(getTaskLaneKey('AX-3448'))).toBe('AX-3448')
    expect(getTaskLaneKey(null)).toBe(NO_TASK_LANE_KEY)
    expect(getTaskKeyFromLaneKey(NO_TASK_LANE_KEY)).toBeNull()
    expect(getTaskKeyFromLaneKey('pr:done')).toBeNull()
  })
})
