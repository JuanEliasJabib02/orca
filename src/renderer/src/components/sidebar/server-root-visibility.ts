import { ALL_EXECUTION_HOSTS_SCOPE } from '../../../../shared/execution-host'
import type { Worktree } from '../../../../shared/worktree/types'
import { getWorktreeHostIdentity } from '../../../../shared/worktree/host-qualified-identity'
import { isWorktreeInSidebarSpace } from './sidebar-space-scope'
import { worktreeMatchesVisibleHost } from './visible-worktree-host-scope'
// Runtime edge only one way: visible-worktrees imports this module, this one only its types.
import type { VisibleWorktreeOptions } from './visible-worktrees'
import { isServerRootWorktree } from './worktree-list/grouping/server-root-lane'

/**
 * Adds back the project roots the workspace filters dropped, for Group by → Task's Servers section:
 * it is how a root's server stays reachable whatever the filters. The space and the host scope
 * still apply, since they say what the sidebar is about rather than hide workspaces inside it.
 * `candidates` is the unfiltered, non-archived list; `visible` comes back as is when nothing was lost.
 */
export function restoreFilteredServerRoots(
  visible: Worktree[],
  candidates: readonly Worktree[],
  opts: VisibleWorktreeOptions
): Worktree[] {
  const hostIds =
    opts.visibleWorkspaceHostIds ??
    (opts.workspaceHostScope === ALL_EXECUTION_HOSTS_SCOPE ? null : [opts.workspaceHostScope])
  const visibleHostIds = hostIds ? new Set(hostIds) : null
  const included = new Set(visible.map(getWorktreeHostIdentity))
  const restored: Worktree[] = []
  for (const worktree of candidates) {
    if (!isServerRootWorktree(worktree, opts.repoMap.get(worktree.repoId))) {
      continue
    }
    const identity = getWorktreeHostIdentity(worktree)
    if (
      !included.has(identity) &&
      (!opts.spaceScope || isWorktreeInSidebarSpace(worktree, opts.spaceScope)) &&
      worktreeMatchesVisibleHost(worktree, visibleHostIds, opts.repoMap, opts.defaultHostId)
    ) {
      included.add(identity)
      restored.push(worktree)
    }
  }
  return restored.length > 0 ? [...visible, ...restored] : visible
}
