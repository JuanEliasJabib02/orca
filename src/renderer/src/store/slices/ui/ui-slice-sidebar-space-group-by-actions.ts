import type { AppState } from '../../types'
import type { UISlice, UISliceGet, UISliceSet } from './ui-slice-contract'
import { resolveActiveSidebarSpaceId } from '../../../components/sidebar/sidebar-space-scope'

type GroupBy = UISlice['groupBy']

// Why a coverage record: a Group by mode missing here would be dropped from every space on hydration.
const GROUP_BY_VALUES = {
  none: true,
  'workspace-status': true,
  repo: true,
  'pr-status': true,
  task: true
} satisfies Record<GroupBy, true>

const UNSAFE_RECORD_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

function isGroupBy(value: unknown): value is GroupBy {
  return typeof value === 'string' && Object.hasOwn(GROUP_BY_VALUES, value)
}

/** Keeps known modes under usable ids; the blob is hand-editable and may come from another build. */
export function sanitizeGroupByBySpaceId(value: unknown): Record<string, GroupBy> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }
  const sanitized: Record<string, GroupBy> = {}
  for (const [spaceId, groupBy] of Object.entries(value)) {
    if (spaceId && !UNSAFE_RECORD_KEYS.has(spaceId) && isGroupBy(groupBy)) {
      sanitized[spaceId] = groupBy
    }
  }
  return sanitized
}

function resolveSpaceId(
  state: Pick<AppState, 'projectGroups'>,
  groupId: string | null
): string | null {
  // Why the fallback: partial stores (early startup, slice tests) have no project groups yet.
  return resolveActiveSidebarSpaceId(groupId, state.projectGroups ?? [])
}

// Why its own ui.set call: an older paired host rejects a whole payload over one unknown key, so
// the per-space map must never take groupBy or the active space down with it.
function persistGroupByBySpaceId(groupByBySpaceId: Record<string, GroupBy>): void {
  window.api.ui.set({ groupByBySpaceId }).catch(console.error)
}

/**
 * Group by is remembered per space while `groupBy` stays the one effective value every reader uses:
 * setting it records it for the active space, and switching spaces applies the new space's choice.
 */
export function createUiSidebarSpaceGroupByActions(
  set: UISliceSet,
  get: UISliceGet
): Partial<UISlice> {
  return {
    groupBy: 'repo',
    groupByBySpaceId: {},
    // Why: group keys are mode-specific, so clear collapsed state on mode switch — stale keys are meaningless and accumulate.
    setGroupBy: (g) => {
      window.api.ui.set({ groupBy: g, collapsedGroups: [] }).catch(console.error)
      const state = get()
      const spaceId = resolveSpaceId(state, state.activeSidebarSpaceGroupId)
      if (!spaceId || state.groupByBySpaceId[spaceId] === g) {
        set({ groupBy: g, collapsedGroups: new Set<string>() })
        return
      }
      const groupByBySpaceId = { ...state.groupByBySpaceId, [spaceId]: g }
      persistGroupByBySpaceId(groupByBySpaceId)
      set({ groupBy: g, collapsedGroups: new Set<string>(), groupByBySpaceId })
    },

    activeSidebarSpaceGroupId: null,
    setActiveSidebarSpaceGroupId: (groupId) => {
      const state = get()
      if (state.activeSidebarSpaceGroupId === groupId) {
        return
      }
      window.api.ui.set({ activeSidebarSpaceGroupId: groupId }).catch(console.error)
      const leavingSpaceId = resolveSpaceId(state, state.activeSidebarSpaceGroupId)
      const enteringSpaceId = resolveSpaceId(state, groupId)
      // Why: a space left before any Group by was chosen in it keeps the one it was showing.
      const seededGroupByBySpaceId =
        leavingSpaceId &&
        leavingSpaceId !== enteringSpaceId &&
        !Object.hasOwn(state.groupByBySpaceId, leavingSpaceId)
          ? { ...state.groupByBySpaceId, [leavingSpaceId]: state.groupBy }
          : null
      if (seededGroupByBySpaceId) {
        persistGroupByBySpaceId(seededGroupByBySpaceId)
        set({ activeSidebarSpaceGroupId: groupId, groupByBySpaceId: seededGroupByBySpaceId })
      } else {
        set({ activeSidebarSpaceGroupId: groupId })
      }
      const next = get()
      const remembered = enteringSpaceId ? next.groupByBySpaceId[enteringSpaceId] : undefined
      if (remembered && remembered !== next.groupBy) {
        next.setGroupBy(remembered)
      }
    }
  }
}
