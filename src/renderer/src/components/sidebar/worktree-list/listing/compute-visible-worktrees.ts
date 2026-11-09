import type { Repo } from '../../../../../../shared/repo-types'
import type { TerminalTab } from '../../../../../../shared/workspace-layout/terminal-tab-types'
import type { WorktreeLineage } from '../../../../../../shared/worktree/lineage-types'
import type { Worktree } from '../../../../../../shared/worktree/types'
import { getWorktreeHostIdentity } from '../../../../../../shared/worktree/host-qualified-identity'
import type { ExecutionHostId, ExecutionHostScope } from '../../../../../../shared/execution-host'
import { getIndexedAllWorktrees } from '@/store/slices/worktrees/listing/worktree-catalog-index'
import { selectVisibleSidebarWorktrees } from '../../../../../../shared/sidebar-list/visible-worktrees'
import type { SidebarLineageParentIdentities } from '../../../../../../shared/sidebar-list/worktree-lineage-projection'
import {
  NO_WORKSPACE_ROW_FILTERS,
  filterWorkspaceRows
} from '../../../../../../shared/workspace-view/workspace-row-filters'
import { buildDesktopWorkspaceRowFactReader } from './desktop-workspace-row-facts'
import { sidebarWorkspaceRowFilters } from '../controls/sidebar-filter-actions'
import { restoreFilteredServerRoots } from '../../server-root-visibility'
import {
  getSpaceRepoFilterIds,
  isWorktreeInSidebarSpace,
  type SidebarSpaceScope
} from '../../sidebar-space-scope'
import { getLineageAncestorIndex, getSortedWorktreeRankIndex } from './visible-worktree-indexes'

// Separate store binding avoids attention-slice import cycles; shared builders retain the filter rules.

export type VisibleWorktreeOptions = {
  filterRepoIds: readonly string[]
  /** Active sidebar space; null or absent = All. Not a filter, so Clear Filters never touches it. */
  spaceScope?: SidebarSpaceScope | null
  showSleepingWorkspaces: boolean
  tabsByWorktree: Record<string, Pick<TerminalTab, 'id'>[]> | null
  ptyIdsByTabId: Record<string, string[]> | null
  browserTabsByWorktree?: Record<string, { id: string }[]> | null
  worktreeIdsWithLiveAgent: ReadonlySet<string>
  worktreeIdsWithStructuredChat?: ReadonlySet<string>
  hideDefaultBranchWorkspace: boolean
  hideAutomationGeneratedWorkspaces: boolean
  hideCliCreatedWorkspaces: boolean
  hideDetachedHeadWorkspaces: boolean
  hideWorkspacesFromOtherDevices: boolean
  pairedDeviceIdsByEnvironment: ReadonlyMap<string, string>
  alwaysShowDefaultBranchWorkspace?: boolean
  repoMap: Map<string, Repo>
  workspaceHostScope: ExecutionHostScope
  visibleWorkspaceHostIds?: readonly ExecutionHostId[] | null
  defaultHostId: ExecutionHostId
  worktreeLineageById: Record<string, WorktreeLineage>
  /** selectSidebarLineageParentIdentities: present only while a store holds a cross-store parent. */
  lineageParentIdentities?: SidebarLineageParentIdentities
  injectLineageAncestors?: boolean
  preserveLineageParentOrder?: boolean
  forcedVisibleWorktreeIds?: readonly string[]
  /** The sorted keys are host identities (the stamp sort's), not bare ids, so a same-id pair keeps two ranks. */
  sortedByHostIdentity?: boolean
  /** Exempt from the sleeping sweep only; unlike forcedVisibleWorktreeIds, every other filter still applies. */
  sleepingSweepExemptWorktreeIds?: ReadonlySet<string>
  /** Group by → Task: git project roots skip the workspace filters (see restoreFilteredServerRoots). */
  keepServerRoots?: boolean
}

export function computeVisibleWorktrees(
  worktreesByRepo: Record<string, Worktree[]>,
  sortedKeys: readonly string[],
  opts: VisibleWorktreeOptions
): Worktree[] {
  const rankByKey = getSortedWorktreeRankIndex(sortedKeys)
  const keyOf = opts.sortedByHostIdentity
    ? getWorktreeHostIdentity
    : (worktree: Worktree) => worktree.id
  const allRows = getIndexedAllWorktrees(worktreesByRepo)
  const { spaceScope } = opts
  const spaceRows = spaceScope
    ? allRows.filter((worktree) => isWorktreeInSidebarSpace(worktree, spaceScope))
    : allRows
  const facts = buildDesktopWorkspaceRowFactReader(opts)
  // Narrows the project filter to the space: a pick made in another space must not empty this one.
  let filters = sidebarWorkspaceRowFilters(opts)
  let rows = spaceRows
  if (opts.keepServerRoots) {
    // Why filtered here: roots rejoin after the filters drop them, before the shared pass ranks and nests.
    rows = restoreFilteredServerRoots(
      filterWorkspaceRows(spaceRows, filters, facts),
      allRows.filter((worktree) => !worktree.isArchived),
      opts
    )
    filters = NO_WORKSPACE_ROW_FILTERS
  }
  return selectVisibleSidebarWorktrees({
    rows,
    ancestorByIdentity: getLineageAncestorIndex(worktreesByRepo),
    rankOf: (worktree) => rankByKey.get(keyOf(worktree)),
    filters,
    facts,
    worktreeLineageById: opts.worktreeLineageById,
    lineageParentIdentities: opts.lineageParentIdentities,
    filterRepoIds: getSpaceRepoFilterIds(opts.filterRepoIds, spaceScope),
    injectLineageAncestors: opts.injectLineageAncestors,
    preserveLineageParentOrder: opts.preserveLineageParentOrder,
    forcedVisibleWorktreeIds: opts.forcedVisibleWorktreeIds
  })
}

export function computeVisibleWorktreeIds(
  worktreesByRepo: Record<string, Worktree[]>,
  sortedKeys: readonly string[],
  opts: VisibleWorktreeOptions
): string[] {
  return computeVisibleWorktrees(worktreesByRepo, sortedKeys, opts).map((worktree) => worktree.id)
}
