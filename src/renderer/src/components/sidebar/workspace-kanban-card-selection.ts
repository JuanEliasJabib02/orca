import type { WorkspaceStatus } from '../../../../shared/worktree/types'
import { getWorktreeHostIdentity } from '../../../../shared/worktree/host-qualified-identity'
import type { WorkspaceKanbanLaneItem } from './workspace-kanban-lane-items'
import {
  updateSelection,
  type SelectionIntent,
  type SelectionResult
} from '@/lib/list-multi-selection'

/**
 * Selection stays keyed by worktree identity; a task card stands for its board-visible members.
 * Only task cards appear here, a plain card's id already is its worktree identity.
 */
export type WorkspaceKanbanCardMembers = {
  memberIdsByCardId: ReadonlyMap<string, readonly string[]>
  cardIdByMemberId: ReadonlyMap<string, string>
}

export const EMPTY_WORKSPACE_KANBAN_CARD_MEMBERS: WorkspaceKanbanCardMembers = {
  memberIdsByCardId: new Map(),
  cardIdByMemberId: new Map()
}

export function buildWorkspaceKanbanCardMembers(
  laneItems: ReadonlyMap<WorkspaceStatus, readonly WorkspaceKanbanLaneItem[]>
): WorkspaceKanbanCardMembers {
  const memberIdsByCardId = new Map<string, readonly string[]>()
  const cardIdByMemberId = new Map<string, string>()
  for (const items of laneItems.values()) {
    for (const item of items) {
      if (item.type !== 'task') {
        continue
      }
      const memberIds = item.worktrees.map(getWorktreeHostIdentity)
      memberIdsByCardId.set(item.key, memberIds)
      for (const memberId of memberIds) {
        cardIdByMemberId.set(memberId, item.key)
      }
    }
  }
  return memberIdsByCardId.size === 0
    ? EMPTY_WORKSPACE_KANBAN_CARD_MEMBERS
    : { memberIdsByCardId, cardIdByMemberId }
}

function getCardMemberIds(cardId: string, members: WorkspaceKanbanCardMembers): readonly string[] {
  const memberIds = members.memberIdsByCardId.get(cardId)
  return memberIds && memberIds.length > 0 ? memberIds : [cardId]
}

/** Card ids (from a marquee or a gesture) as worktree identities, a task card as all its members. */
export function expandWorkspaceKanbanCardIds(
  cardIds: readonly string[],
  members: WorkspaceKanbanCardMembers
): readonly string[] {
  if (members.memberIdsByCardId.size === 0) {
    return cardIds
  }
  return cardIds.flatMap((cardId) => getCardMemberIds(cardId, members))
}

// Why: a range bound can land inside a task card; the card is selected whole or not at all.
function expandToWholeCards(
  selectedIds: Set<string>,
  members: WorkspaceKanbanCardMembers
): Set<string> {
  if (members.cardIdByMemberId.size === 0) {
    return selectedIds
  }
  const expanded = new Set(selectedIds)
  for (const id of selectedIds) {
    const cardId = members.cardIdByMemberId.get(id)
    for (const memberId of cardId ? getCardMemberIds(cardId, members) : []) {
      expanded.add(memberId)
    }
  }
  return expanded
}

/**
 * A click, toggle or range gesture on one card. A task card selects, deselects or bounds a range
 * with all its members; with no task cards this is exactly updateSelection.
 */
export function updateWorkspaceKanbanCardSelection(args: {
  visibleIds: readonly string[]
  previousSelectedIds: ReadonlySet<string>
  previousAnchorId: string | null
  cardId: string
  intent: SelectionIntent
  members: WorkspaceKanbanCardMembers
}): SelectionResult {
  const memberIds = getCardMemberIds(args.cardId, args.members)
  const firstId = memberIds[0] ?? args.cardId
  if (args.intent === 'replace') {
    return { selectedIds: new Set(memberIds), anchorId: firstId }
  }
  if (args.intent === 'toggle') {
    const selectedIds = new Set(args.previousSelectedIds)
    const select = !memberIds.every((id) => selectedIds.has(id))
    for (const id of memberIds) {
      if (select) {
        selectedIds.add(id)
      } else {
        selectedIds.delete(id)
      }
    }
    return { selectedIds, anchorId: firstId }
  }
  const anchorIndex = args.previousAnchorId ? args.visibleIds.indexOf(args.previousAnchorId) : -1
  // Why the far member: a range running down to a task card must cover all of it.
  const targetId =
    anchorIndex !== -1 && args.visibleIds.indexOf(firstId) > anchorIndex
      ? (memberIds.at(-1) ?? firstId)
      : firstId
  const result = updateSelection({
    visibleIds: args.visibleIds,
    previousSelectedIds: args.previousSelectedIds,
    previousAnchorId: args.previousAnchorId,
    targetId,
    intent: 'range'
  })
  return {
    selectedIds: expandToWholeCards(result.selectedIds, args.members),
    anchorId: result.anchorId
  }
}

/** The selection as card ids: worktree identities plus every task card whose members are all selected. */
export function getSelectedWorkspaceKanbanCardIds(
  selectedIds: ReadonlySet<string>,
  members: WorkspaceKanbanCardMembers
): ReadonlySet<string> {
  if (members.memberIdsByCardId.size === 0 || selectedIds.size === 0) {
    return selectedIds
  }
  const cardIds = new Set(selectedIds)
  for (const [cardId, memberIds] of members.memberIdsByCardId) {
    if (memberIds.length > 0 && memberIds.every((id) => selectedIds.has(id))) {
      cardIds.add(cardId)
    }
  }
  return cardIds
}
