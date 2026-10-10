import { describe, expect, it } from 'vitest'
import type { Worktree } from '../../../../shared/worktree/types'
import { makeWorktree } from '../../store/slices/store-test-helpers'
import {
  buildWorkspaceKanbanCardMembers,
  EMPTY_WORKSPACE_KANBAN_CARD_MEMBERS,
  expandWorkspaceKanbanCardIds,
  getSelectedWorkspaceKanbanCardIds,
  updateWorkspaceKanbanCardSelection,
  type WorkspaceKanbanCardMembers
} from './workspace-kanban-card-selection'
import {
  toWorkspaceKanbanWorktreeLaneItem,
  type WorkspaceKanbanLaneItem
} from './workspace-kanban-lane-items'
import { updateSelection } from '@/lib/list-multi-selection'

function worktree(id: string): Worktree {
  return makeWorktree({ id, repoId: id, hostId: 'local' })
}

const top = worktree('top')
const api = worktree('api')
const web = worktree('web')
const bottom = worktree('bottom')

// Lane: top, [AX-1: api, web], bottom.
const laneItems = new Map<string, WorkspaceKanbanLaneItem[]>([
  [
    'todo',
    [
      toWorkspaceKanbanWorktreeLaneItem(top),
      {
        type: 'task',
        key: 'task:AX-1',
        status: 'todo',
        task: { taskKey: 'AX-1', title: null, worktrees: [], folderWorkspaceIds: [] },
        worktrees: [api, web],
        memberIds: ['api', 'web', 'hidden']
      },
      toWorkspaceKanbanWorktreeLaneItem(bottom)
    ]
  ]
])
const members: WorkspaceKanbanCardMembers = buildWorkspaceKanbanCardMembers(laneItems)
const VISIBLE = ['local|top', 'local|api', 'local|web', 'local|bottom']

function select(args: {
  cardId: string
  intent: 'replace' | 'toggle' | 'range'
  previous?: readonly string[]
  anchor?: string | null
}): { selected: string[]; anchor: string } {
  const result = updateWorkspaceKanbanCardSelection({
    visibleIds: VISIBLE,
    previousSelectedIds: new Set(args.previous ?? []),
    previousAnchorId: args.anchor ?? null,
    cardId: args.cardId,
    intent: args.intent,
    members
  })
  return { selected: [...result.selectedIds].sort(), anchor: result.anchorId }
}

describe('buildWorkspaceKanbanCardMembers', () => {
  it('maps each task card to its board-visible member identities and back', () => {
    expect(members.memberIdsByCardId.get('task:AX-1')).toEqual(['local|api', 'local|web'])
    expect(members.cardIdByMemberId.get('local|web')).toBe('task:AX-1')
    expect(members.memberIdsByCardId.has('local|top')).toBe(false)
  })

  it('shares the empty value when the board has no task cards', () => {
    const plainOnly = new Map([['todo', [toWorkspaceKanbanWorktreeLaneItem(top)]]])
    expect(buildWorkspaceKanbanCardMembers(plainOnly)).toBe(EMPTY_WORKSPACE_KANBAN_CARD_MEMBERS)
  })
})

describe('updateWorkspaceKanbanCardSelection', () => {
  it('selects every member of a clicked task card', () => {
    expect(select({ cardId: 'task:AX-1', intent: 'replace', previous: ['local|top'] })).toEqual({
      selected: ['local|api', 'local|web'],
      anchor: 'local|api'
    })
  })

  it('toggles a task card in and out as a whole', () => {
    expect(select({ cardId: 'task:AX-1', intent: 'toggle', previous: ['local|top'] })).toEqual({
      selected: ['local|api', 'local|top', 'local|web'],
      anchor: 'local|api'
    })
    expect(
      select({
        cardId: 'task:AX-1',
        intent: 'toggle',
        previous: ['local|top', 'local|api', 'local|web']
      }).selected
    ).toEqual(['local|top'])
  })

  it('completes a partly selected task card on toggle', () => {
    expect(
      select({ cardId: 'task:AX-1', intent: 'toggle', previous: ['local|api'] }).selected
    ).toEqual(['local|api', 'local|web'])
  })

  it('runs a range down to a task card over all of its members', () => {
    expect(
      select({ cardId: 'task:AX-1', intent: 'range', previous: ['local|top'], anchor: 'local|top' })
    ).toEqual({ selected: ['local|api', 'local|top', 'local|web'], anchor: 'local|top' })
  })

  it('keeps the anchor task card whole when a range runs past it', () => {
    expect(
      select({
        cardId: 'local|bottom',
        intent: 'range',
        previous: ['local|api', 'local|web'],
        anchor: 'local|api'
      }).selected
    ).toEqual(['local|api', 'local|bottom', 'local|web'])
    expect(
      select({
        cardId: 'local|top',
        intent: 'range',
        previous: ['local|api', 'local|web'],
        anchor: 'local|api'
      }).selected
    ).toEqual(['local|api', 'local|top', 'local|web'])
  })

  it('matches updateSelection exactly when the board has no task cards', () => {
    for (const intent of ['replace', 'toggle', 'range'] as const) {
      const args = {
        visibleIds: ['a', 'b', 'c'],
        previousSelectedIds: new Set(['a']),
        previousAnchorId: 'a',
        intent
      }
      expect(
        updateWorkspaceKanbanCardSelection({
          ...args,
          cardId: 'c',
          members: EMPTY_WORKSPACE_KANBAN_CARD_MEMBERS
        })
      ).toEqual(updateSelection({ ...args, targetId: 'c' }))
    }
  })
})

describe('expandWorkspaceKanbanCardIds', () => {
  it('turns a marquee over a task card into its members', () => {
    expect(expandWorkspaceKanbanCardIds(['local|top', 'task:AX-1'], members)).toEqual([
      'local|top',
      'local|api',
      'local|web'
    ])
  })

  it('returns plain card ids untouched without task cards', () => {
    const ids = ['local|top']
    expect(expandWorkspaceKanbanCardIds(ids, EMPTY_WORKSPACE_KANBAN_CARD_MEMBERS)).toBe(ids)
  })
})

describe('getSelectedWorkspaceKanbanCardIds', () => {
  it('adds a task card only once all of its members are selected', () => {
    expect(
      getSelectedWorkspaceKanbanCardIds(new Set(['local|api']), members).has('task:AX-1')
    ).toBe(false)
    expect(getSelectedWorkspaceKanbanCardIds(new Set(['local|api', 'local|web']), members)).toEqual(
      new Set(['local|api', 'local|web', 'task:AX-1'])
    )
  })
})
