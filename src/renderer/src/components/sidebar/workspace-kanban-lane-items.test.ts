import { describe, expect, it } from 'vitest'
import type { WorkspaceStatusDefinition, Worktree } from '../../../../shared/worktree/types'
import { makeWorktree } from '../../store/slices/store-test-helpers'
import type { SidebarSpaceScope } from './sidebar-space-scope'
import { buildWorktreeTaskKeys } from './worktree-list/grouping/worktree-task-keys'
import {
  buildWorkspaceKanbanLaneItems,
  buildWorkspaceKanbanTaskMoveIndex,
  collectWorkspaceKanbanTaskMoveIds,
  expandWorkspaceKanbanTaskMoveIds,
  getLaneItemWorktreeIds,
  isSameTaskSectionInfo,
  type WorkspaceKanbanLaneItem,
  type WorkspaceKanbanTaskGrouping,
  type WorkspaceKanbanTaskLaneItem
} from './workspace-kanban-lane-items'

const STATUSES: WorkspaceStatusDefinition[] = [
  { id: 'todo', label: 'Todo' },
  { id: 'in-progress', label: 'In progress' },
  { id: 'done', label: 'Done' }
]

function worktree(repoId: string, branch: string, overrides: Partial<Worktree> = {}): Worktree {
  return makeWorktree({
    id: `${repoId}::/${branch}`,
    repoId,
    branch: `refs/heads/${branch}`,
    displayName: branch,
    hostId: 'local',
    ...overrides
  })
}

function grouping(
  allWorktrees: readonly Worktree[],
  moveIdsByTaskKey: ReadonlyMap<string, readonly string[]> = new Map()
): WorkspaceKanbanTaskGrouping {
  return { taskKeys: buildWorktreeTaskKeys(allWorktrees), moveIdsByTaskKey }
}

function lanes(byStatus: Record<string, Worktree[]>): Map<string, Worktree[]> {
  return new Map(STATUSES.map((status) => [status.id, byStatus[status.id] ?? []]))
}

function describeLane(items: readonly WorkspaceKanbanLaneItem[] | undefined): string[] {
  return (items ?? []).map((item) => {
    if (item.type === 'project-header') {
      return `header ${item.label}`
    }
    return item.type === 'task' ? `task ${item.task.taskKey}` : item.worktree.id
  })
}

function taskItem(
  items: readonly WorkspaceKanbanLaneItem[] | undefined,
  taskKey: string
): WorkspaceKanbanTaskLaneItem {
  const task = items?.find((item) => item.type === 'task' && item.task.taskKey === taskKey)
  if (task?.type !== 'task') {
    throw new Error(`no ${taskKey} card in lane`)
  }
  return task
}

const AX_REPOS = [
  'backend-action',
  'action-sport-club',
  'checkout-action-experience',
  'reset',
  'landing_action_experience',
  'admin-action'
]

describe('buildWorkspaceKanbanLaneItems', () => {
  it('renders one card per worktree, in lane order, without task grouping', () => {
    const a = worktree('api', 'juan/AX-1')
    const b = worktree('web', 'juan/AX-1')
    const worktreesByStatus = lanes({ todo: [a, b] })

    const first = buildWorkspaceKanbanLaneItems({
      worktreesByStatus,
      workspaceStatuses: STATUSES,
      taskGrouping: null
    })
    const second = buildWorkspaceKanbanLaneItems({
      worktreesByStatus,
      workspaceStatuses: STATUSES,
      taskGrouping: null
    })

    expect(describeLane(first.get('todo'))).toEqual([a.id, b.id])
    expect(first.get('todo')?.[0]?.key).toBe('local|api::/juan/AX-1')
    // Why: memoized cards rely on unchanged worktrees keeping their item.
    expect(second.get('todo')?.[0]).toBe(first.get('todo')?.[0])
  })

  it('folds AX-3447 across six repos into one card', () => {
    const members = AX_REPOS.map((repoId) => worktree(repoId, 'juan/AX-3447'))
    const loose = worktree('backend-action', 'juan/fix-login')
    const all = [loose, ...members]

    const items = buildWorkspaceKanbanLaneItems({
      worktreesByStatus: lanes({ 'in-progress': all }),
      workspaceStatuses: STATUSES,
      taskGrouping: grouping(all)
    })

    // Why fix-login is a card of its own: every named workspace is a task, named by its branch.
    expect(describeLane(items.get('in-progress'))).toEqual(['task fix-login', 'task AX-3447'])
    const card = taskItem(items.get('in-progress'), 'AX-3447')
    expect(card.key).toBe('task:AX-3447')
    expect(card.worktrees).toEqual(members)
    expect(card.task.worktrees.map((member) => member.repoId)).toEqual(AX_REPOS)
    expect(card.task.folderWorkspaceIds).toEqual([])
  })

  it('places the card in the least advanced lane, at its first member there', () => {
    const inDone = worktree('api', 'juan/AX-7')
    const inTodo = worktree('web', 'juan/AX-7')
    const inProgress = worktree('admin', 'juan/AX-7')
    const before = worktree('web', 'juan/cleanup')
    const after = worktree('web', 'juan/tidy')
    const all = [inDone, inTodo, inProgress, before, after]

    const items = buildWorkspaceKanbanLaneItems({
      worktreesByStatus: lanes({
        todo: [before, inTodo, after],
        'in-progress': [inProgress],
        done: [inDone]
      }),
      workspaceStatuses: STATUSES,
      taskGrouping: grouping(all)
    })

    expect(describeLane(items.get('todo'))).toEqual(['task cleanup', 'task AX-7', 'task tidy'])
    expect(describeLane(items.get('in-progress'))).toEqual([])
    expect(describeLane(items.get('done'))).toEqual([])
    const card = taskItem(items.get('todo'), 'AX-7')
    expect(card.status).toBe('todo')
    // Members from every lane, in board order.
    expect(card.worktrees).toEqual([inTodo, inProgress, inDone])
  })

  it('uses the statuses order, not the map order, to pick the least advanced lane', () => {
    const early = worktree('api', 'juan/AX-8')
    const late = worktree('web', 'juan/AX-8')
    const all = [early, late]

    const items = buildWorkspaceKanbanLaneItems({
      worktreesByStatus: new Map([
        ['done', [late]],
        ['todo', [early]]
      ]),
      workspaceStatuses: STATUSES,
      taskGrouping: grouping(all)
    })

    expect(describeLane(items.get('todo'))).toEqual(['task AX-8'])
    expect(describeLane(items.get('done'))).toEqual([])
  })

  it('keeps a single-worktree task as a task card', () => {
    const only = worktree('api', 'juan/AX-9')

    const items = buildWorkspaceKanbanLaneItems({
      worktreesByStatus: lanes({ todo: [only] }),
      workspaceStatuses: STATUSES,
      taskGrouping: grouping([only])
    })

    expect(describeLane(items.get('todo'))).toEqual(['task AX-9'])
  })

  it('names a key-less worktree after its branch and keeps folder workspaces as plain cards', () => {
    const keyed = worktree('api', 'juan/AX-10')
    const keyless = worktree('api', 'juan/refactor')
    const folder = makeWorktree({
      id: 'folder:notes',
      repoId: 'folder-workspace:work',
      branch: '',
      displayName: 'AX-10 notes',
      hostId: 'local'
    })
    const all = [keyed, keyless, folder]

    const items = buildWorkspaceKanbanLaneItems({
      worktreesByStatus: lanes({ todo: [folder, keyed, keyless] }),
      workspaceStatuses: STATUSES,
      taskGrouping: grouping(all)
    })

    expect(describeLane(items.get('todo'))).toEqual([folder.id, 'task AX-10', 'task refactor'])
    expect(taskItem(items.get('todo'), 'AX-10').worktrees).toEqual([keyed])
  })

  it('moves every space member, hidden ones included, plus the board-visible ones', () => {
    const visible = worktree('api', 'juan/AX-11')
    const items = buildWorkspaceKanbanLaneItems({
      worktreesByStatus: lanes({ todo: [visible] }),
      workspaceStatuses: STATUSES,
      taskGrouping: grouping([visible], new Map([['AX-11', ['web::/hidden', 'admin::/hidden']]]))
    })

    expect(taskItem(items.get('todo'), 'AX-11').memberIds).toEqual([
      'web::/hidden',
      'admin::/hidden',
      visible.id
    ])
  })

  it('titles the card from the linked Jira item carrying its key', () => {
    const linked = worktree('api', 'juan/AX-12', {
      linkedWorkItem: {
        provider: 'jira',
        type: 'issue',
        number: 12,
        title: 'Checkout flow',
        url: 'https://jira.example/AX-12',
        jiraIdentifier: 'AX-12'
      }
    })
    const plain = worktree('web', 'juan/AX-12')

    const items = buildWorkspaceKanbanLaneItems({
      worktreesByStatus: lanes({ todo: [plain, linked] }),
      workspaceStatuses: STATUSES,
      taskGrouping: grouping([plain, linked])
    })

    expect(taskItem(items.get('todo'), 'AX-12').task.title).toBe('Checkout flow')
  })

  it('keeps every lane worktree in card order for drag groups', () => {
    const a = worktree('api', 'juan/AX-13')
    const loose = worktree('api', 'juan/chore')
    const b = worktree('web', 'juan/AX-13')

    const items = buildWorkspaceKanbanLaneItems({
      worktreesByStatus: lanes({ todo: [a, loose, b] }),
      workspaceStatuses: STATUSES,
      taskGrouping: grouping([a, loose, b])
    })

    // Why: the task's members sit together, at the card, not where each one sorted.
    expect(getLaneItemWorktreeIds(items.get('todo') ?? [])).toEqual([a.id, b.id, loose.id])
  })
})

describe('collectWorkspaceKanbanTaskMoveIds', () => {
  const work: SidebarSpaceScope = {
    groupIds: new Set(['work']),
    repoIds: new Set(['api', 'web', 'admin']),
    folderWorkspaceIds: new Set(['notes'])
  }
  const api = worktree('api', 'juan/AX-20')
  // Hidden from the board by a filter; the collector never looks at visibility.
  const filteredOut = worktree('admin', 'juan/AX-20')
  const primary = worktree('web', 'AX-20', { isMainWorktree: true })
  const archived = worktree('web', 'juan/AX-20', { isArchived: true })
  const otherSpace = worktree('personal', 'juan/AX-20')
  const folder = makeWorktree({
    id: 'folder:notes',
    repoId: 'folder-workspace:work',
    branch: '',
    displayName: 'AX-20 notes'
  })
  const all = [api, filteredOut, primary, archived, otherSpace, folder]

  it('collects the space members a move carries, filtered-out ones included', () => {
    const moveIds = collectWorkspaceKanbanTaskMoveIds({
      allWorktrees: all,
      taskKeys: buildWorktreeTaskKeys(all),
      spaceScope: work
    })

    expect(moveIds.get('AX-20')).toEqual([api.id, filteredOut.id])
  })

  it('spans every space when none is active', () => {
    const moveIds = collectWorkspaceKanbanTaskMoveIds({
      allWorktrees: all,
      taskKeys: buildWorktreeTaskKeys(all),
      spaceScope: null
    })

    expect(moveIds.get('AX-20')).toEqual([api.id, filteredOut.id, otherSpace.id])
  })
})

describe('task move expansion', () => {
  const a = worktree('api', 'juan/AX-30')
  const b = worktree('web', 'juan/AX-30')
  const loose = worktree('api', 'juan/chore')
  const items = buildWorkspaceKanbanLaneItems({
    worktreesByStatus: lanes({ todo: [a, b, loose] }),
    workspaceStatuses: STATUSES,
    taskGrouping: grouping([a, b, loose], new Map([['AX-30', [a.id, b.id, 'admin::/hidden']]]))
  })
  const moveIndex = buildWorkspaceKanbanTaskMoveIndex(items)

  it('widens one member to every worktree of its task', () => {
    expect(expandWorkspaceKanbanTaskMoveIds([a.id], moveIndex)).toEqual([
      a.id,
      b.id,
      'admin::/hidden'
    ])
  })

  it('keeps plain cards and de-duplicates a selection holding several members', () => {
    expect(expandWorkspaceKanbanTaskMoveIds([loose.id, b.id, a.id], moveIndex)).toEqual([
      loose.id,
      a.id,
      b.id,
      'admin::/hidden'
    ])
  })

  it('returns the ids untouched when the board has no task cards', () => {
    const ids = [a.id, loose.id]
    expect(expandWorkspaceKanbanTaskMoveIds(ids, new Map())).toBe(ids)
  })
})

describe('isSameTaskSectionInfo', () => {
  const task = {
    taskKey: 'AX-1',
    title: null,
    worktrees: [{ worktreeId: 'a', repoId: 'api' }],
    folderWorkspaceIds: []
  }

  it('matches a rebuilt copy and rejects a changed member list or title', () => {
    expect(
      isSameTaskSectionInfo(task, { ...task, worktrees: [{ worktreeId: 'a', repoId: 'api' }] })
    ).toBe(true)
    expect(isSameTaskSectionInfo(task, { ...task, worktrees: [] })).toBe(false)
    expect(isSameTaskSectionInfo(task, { ...task, title: 'Checkout' })).toBe(false)
  })
})
