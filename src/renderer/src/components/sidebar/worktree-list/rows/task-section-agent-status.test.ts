import { describe, expect, it } from 'vitest'
import type { LiveAgentWorktreeStatus } from '@/lib/worktree-activity-state'
import { getTaskSectionStatusIds, rollUpTaskAgentStatus } from './task-section-agent-status'

function statuses(
  entries: [string, LiveAgentWorktreeStatus][]
): ReadonlyMap<string, LiveAgentWorktreeStatus> {
  return new Map(entries)
}

describe('rollUpTaskAgentStatus', () => {
  it('lets a waiting permission outrank agents that are still working', () => {
    expect(
      rollUpTaskAgentStatus(
        ['wt-a', 'wt-b', 'wt-c'],
        statuses([
          ['wt-a', 'working'],
          ['wt-b', 'permission'],
          ['wt-c', 'monitoring']
        ])
      )
    ).toBe('permission')
  })

  it('prefers working over monitoring', () => {
    expect(
      rollUpTaskAgentStatus(
        ['wt-a', 'wt-b'],
        statuses([
          ['wt-a', 'monitoring'],
          ['wt-b', 'working']
        ])
      )
    ).toBe('working')
  })

  it('ignores agents outside the task and returns null when none is live', () => {
    const live = statuses([['wt-other', 'permission']])

    expect(rollUpTaskAgentStatus(['wt-a'], live)).toBeNull()
    expect(rollUpTaskAgentStatus([], live)).toBeNull()
  })
})

describe('getTaskSectionStatusIds', () => {
  it('keys folder workspaces the way the agent-status store does', () => {
    expect(
      getTaskSectionStatusIds({
        taskKey: 'AX-1',
        title: null,
        worktrees: [{ worktreeId: 'wt-a', repoId: 'repo-1' }],
        folderWorkspaceIds: ['fw-1']
      })
    ).toEqual(['wt-a', 'folder:fw-1'])
  })
})
