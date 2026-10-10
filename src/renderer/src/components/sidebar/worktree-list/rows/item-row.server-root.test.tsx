import type React from 'react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../../WorktreeCard', () => ({ default: () => null }))
vi.mock('@/lib/open-spotlight-terminal-tab', () => ({ selectSpotlightTerminalTab: vi.fn() }))

import { worktree } from '../../worktree-list-groups-test-fixtures'
import { WORKTREE_ROW_DRAG_INITIAL_STATE } from '../drag/row-state'
import { SERVERS_LANE_KEY } from '../grouping/server-root-lane'
import { NO_TASK_LANE_KEY } from '../grouping/worktree-task-key'
import type { WorktreeItemRow } from '../listing/renderable-rows'
import { renderWorktreeItemRow, type WorktreeItemRowContext } from './item-row'
import { getServerRootActivateHandler } from './server-root-activation'

const ROOT = { ...worktree, id: 'backend::/root', isMainWorktree: true }

const ctx: WorktreeItemRowContext = {
  settings: null,
  groupBy: 'task',
  folderBackedProjectGroupIds: new Set(),
  groupKeyByRowKey: new Map(),
  groupIndexByRowKey: new Map(),
  agentSendTargetWorktreeId: null,
  worktreeDragState: WORKTREE_ROW_DRAG_INITIAL_STATE,
  nativeLineageDropTargetId: null,
  activeWorktreeId: null,
  activeWorkspaceExecutionHostId: null,
  currentWorktreeId: null,
  highlightedRevealRowKey: null,
  selectedWorktreeIds: new Set(),
  selectedWorktrees: [],
  getActiveSurfaceVariant: () => 'primary',
  getLineageToggleHandler: () => vi.fn(),
  onSelectionGesture: () => false,
  onContextMenuSelect: () => [],
  onImmediateActivate: vi.fn(),
  onRowClickCapture: vi.fn(),
  onRowPointerDown: vi.fn(),
  onCardDragStart: vi.fn(),
  onCardDragEnd: vi.fn()
}

function rowIn(sectionKey: string): WorktreeItemRow {
  return {
    type: 'item',
    rowKey: `${sectionKey}:${ROOT.id}`,
    sectionKey,
    worktree: ROOT,
    repo: undefined,
    depth: 0,
    groupDepth: 0,
    lineageTrail: [],
    isLastLineageChild: false,
    lineageChildCount: 0
  }
}

function cardOnActivate(sectionKey: string): (() => void) | undefined {
  const card: React.ReactElement<{ onActivate?: () => void }> = renderWorktreeItemRow(
    ctx,
    rowIn(sectionKey),
    false
  ).props.children
  return card.props.onActivate
}

describe('renderWorktreeItemRow for a project root', () => {
  it('opens a Servers row on its Spotlight terminal after the plain open', () => {
    const onActivate = cardOnActivate(SERVERS_LANE_KEY)

    expect(onActivate).toBeDefined()
    expect(onActivate).toBe(getServerRootActivateHandler(SERVERS_LANE_KEY, ROOT.id))
  })

  it('opens the same root from any other section as it always did', () => {
    expect(cardOnActivate(NO_TASK_LANE_KEY)).toBeUndefined()
    expect(cardOnActivate('repo:backend')).toBeUndefined()
  })
})
