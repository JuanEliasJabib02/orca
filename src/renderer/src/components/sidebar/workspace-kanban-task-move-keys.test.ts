import { describe, expect, it } from 'vitest'
import type { ExecutionHostId } from '../../../../shared/execution-host'
import type { Worktree } from '../../../../shared/worktree/types'
import { makeWorktree } from '@/store/slices/worktrees/worktree.test-fixture'
import {
  toWorkspaceKanbanWorktreeLaneItem,
  type WorkspaceKanbanLaneItem,
  type WorkspaceKanbanTaskLaneItem
} from './workspace-kanban-lane-items'
import { buildWorkspaceKanbanTaskMoveKeyIndex } from './workspace-kanban-task-move-keys'
import { buildUnambiguousWorktreeIdIndex } from './worktree-list/navigation/worktree-unambiguous-id-index'

function worktree(id: string, hostId: ExecutionHostId = 'local'): Worktree {
  return makeWorktree({ id, repoId: id, hostId })
}

function taskItem(worktrees: Worktree[], memberIds: string[]): WorkspaceKanbanTaskLaneItem {
  return {
    type: 'task',
    key: 'task:AX-1',
    status: 'todo',
    task: { taskKey: 'AX-1', title: null, worktrees: [], folderWorkspaceIds: [] },
    worktrees,
    memberIds
  }
}

describe('buildWorkspaceKanbanTaskMoveKeyIndex', () => {
  it('maps a task card key and its visible members to every member identity', () => {
    const api = worktree('api')
    const web = worktree('web')
    const hidden = worktree('admin')
    const plain = worktree('plain')
    const laneItems = new Map<string, WorkspaceKanbanLaneItem[]>([
      [
        'todo',
        [toWorkspaceKanbanWorktreeLaneItem(plain), taskItem([api, web], ['api', 'web', 'admin'])]
      ]
    ])

    const index = buildWorkspaceKanbanTaskMoveKeyIndex(
      laneItems,
      buildUnambiguousWorktreeIdIndex([api, web, hidden, plain])
    )

    const expected = ['local|api', 'local|web', 'local|admin']
    expect(index.get('task:AX-1')).toEqual(expected)
    expect(index.get('local|api')).toEqual(expected)
    expect(index.get('local|web')).toEqual(expected)
    // Plain cards and hidden members are not keys: only what a drag can carry is.
    expect(index.has('local|plain')).toBe(false)
    expect(index.has('local|admin')).toBe(false)
  })

  it('keeps a visible same-id member on its own host and leaves out a hidden ambiguous id', () => {
    const local = worktree('shared', 'local')
    const remote = worktree('shared', 'ssh:host-b')
    const twinA = worktree('twin', 'local')
    const twinB = worktree('twin', 'ssh:host-b')
    const laneItems = new Map<string, WorkspaceKanbanLaneItem[]>([
      ['todo', [taskItem([local], ['shared', 'twin'])]]
    ])

    const index = buildWorkspaceKanbanTaskMoveKeyIndex(
      laneItems,
      buildUnambiguousWorktreeIdIndex([local, remote, twinA, twinB])
    )

    expect(index.get('task:AX-1')).toEqual(['local|shared'])
  })
})
