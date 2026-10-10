import { isWorktreePaletteQueryTooLarge } from '@/lib/worktree-palette-query-bounds'
import { searchWorktreeDocuments } from '@/lib/worktree-palette-search'
import { buildWorktreePaletteDocuments } from '@/lib/worktree-palette-document'
import type { PaletteDocument } from '@/lib/palette-match/palette-document'
import type { Repo } from '../../../../shared/repo-types'
import type { WorkspaceStatus, Worktree } from '../../../../shared/worktree/types'
import {
  composeWorktreeHostIdentity,
  getWorktreeHostIdentity
} from '../../../../shared/worktree/host-qualified-identity'
import {
  countLaneCards,
  type WorkspaceKanbanCardLaneItem,
  type WorkspaceKanbanLaneItem,
  type WorkspaceKanbanProjectHeaderLaneItem
} from './workspace-kanban-lane-items'

export type WorkspaceKanbanLaneView = {
  items: readonly WorkspaceKanbanLaneItem[]
  /** Cards in the lane before search filtering; a task card counts once. */
  totalCount: number
}

/**
 * Builds the board's palette index once per worktree/repo identity.
 *
 * Why separate from the match: the index is identical across keystrokes, and building it inline
 * meant normalizing and segmenting every indexed field of every worktree on every character —
 * and again on every agent-status tick, which churns board identities while a query is active.
 */
export function buildWorkspaceBoardPaletteDocuments(args: {
  worktrees: readonly Worktree[]
  repoMap: ReadonlyMap<string, Repo>
}): Map<string, PaletteDocument> {
  // Why the board policy (#15170): the board is a drag surface for named workspaces, so a card
  // may only be hidden by text printed on it. Ports, reviews and automation runs are palette-only.
  return buildWorktreePaletteDocuments(args.worktrees, {
    repoMap: args.repoMap,
    evidencePolicy: 'board'
  })
}

/**
 * Returns `null` when no filtering is active — distinct from an empty set, which
 * means a real query matched nothing.
 */
export function matchWorkspaceBoardWorktrees(args: {
  worktrees: Worktree[]
  query: string
  repoMap: Map<string, Repo>
  documents?: ReadonlyMap<string, PaletteDocument>
}): ReadonlySet<string> | null {
  if (!args.query.trim()) {
    return null
  }
  // Why: searchWorktrees returns [] for an over-bound query, which downstream
  // reads as "matched nothing" and blanks the whole board on a paste accident.
  if (isWorktreePaletteQueryTooLarge(args.query)) {
    return null
  }

  const matched = new Set<string>()
  const documents =
    args.documents ??
    buildWorkspaceBoardPaletteDocuments({ worktrees: args.worktrees, repoMap: args.repoMap })
  for (const result of searchWorktreeDocuments({
    worktrees: args.worktrees,
    query: args.query,
    documents,
    repoMap: args.repoMap
  })) {
    if (result.matchedFields.length) {
      // Why (STA-4343): two hosts can publish the same id, and a board filter keyed on the
      // bare id would show or hide both hosts' cards together.
      matched.add(composeWorktreeHostIdentity(result.worktreeHostId, result.worktreeId))
    }
  }
  return matched
}

// Why: the card prints the task key and title, so they may keep it on screen like a member's text.
function isTaskTextMatch(
  task: { taskKey: string | null; title: string | null },
  query: string | null | undefined
): boolean {
  const needle = query?.trim().toLowerCase()
  return Boolean(
    needle &&
    [task.taskKey, task.title].some((text) => text?.toLowerCase().includes(needle) ?? false)
  )
}

function isLaneItemMatch(
  item: WorkspaceKanbanCardLaneItem,
  matchingWorktreeIds: ReadonlySet<string>,
  query: string | null | undefined
): boolean {
  if (item.type === 'worktree') {
    return matchingWorktreeIds.has(getWorktreeHostIdentity(item.worktree))
  }
  return (
    item.worktrees.some((worktree) => matchingWorktreeIds.has(getWorktreeHostIdentity(worktree))) ||
    isTaskTextMatch(item.task, query)
  )
}

/** Keeps the matching cards; a project header stays only over a shown card, recounted. */
function filterLaneItems(
  items: readonly WorkspaceKanbanLaneItem[],
  isMatch: (item: WorkspaceKanbanCardLaneItem) => boolean
): WorkspaceKanbanLaneItem[] {
  const kept: WorkspaceKanbanLaneItem[] = []
  let header: WorkspaceKanbanProjectHeaderLaneItem | null = null
  let cards: WorkspaceKanbanCardLaneItem[] = []
  const flushSection = (): void => {
    if (cards.length === 0) {
      return
    }
    if (header) {
      kept.push(header.count === cards.length ? header : { ...header, count: cards.length })
    }
    for (const card of cards) {
      kept.push(card)
    }
  }
  for (const item of items) {
    if (item.type === 'project-header') {
      flushSection()
      header = item
      cards = []
    } else if (isMatch(item)) {
      cards.push(item)
    }
  }
  flushSection()
  return kept
}

/** A task card stays whole: it shows, with every member, when any member or its key matches. */
export function buildWorkspaceKanbanLaneViews(args: {
  laneItems: ReadonlyMap<WorkspaceStatus, readonly WorkspaceKanbanLaneItem[]>
  matchingWorktreeIds: ReadonlySet<string> | null
  /** The query behind `matchingWorktreeIds`, for the task key and title. */
  query?: string | null
}): Map<WorkspaceStatus, WorkspaceKanbanLaneView> {
  const matchingWorktreeIds = args.matchingWorktreeIds
  const views = new Map<WorkspaceStatus, WorkspaceKanbanLaneView>()
  for (const [status, items] of args.laneItems) {
    views.set(status, {
      // Why: the no-query path must not reallocate a lane array per keystroke.
      items: matchingWorktreeIds
        ? filterLaneItems(items, (item) => isLaneItemMatch(item, matchingWorktreeIds, args.query))
        : items,
      totalCount: countLaneCards(items)
    })
  }
  return views
}
