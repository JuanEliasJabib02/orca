import { comparePorts, getWorkspacePortsByWorktreeId } from '@/lib/workspace-port-groups'
import type { AppState } from '@/store/types'
import type { WorkspacePort } from '../../../../shared/workspace-ports'
import type { Worktree } from '../../../../shared/worktree/types'
import { EMPTY_WORKSPACE_PORTS } from './worktree-card-model'

export type SpotlightPortsState = Pick<
  AppState,
  'workspacePortScan' | 'spotlightByRepo' | 'worktreesByRepo'
>
type SpotlightPortsRow = Pick<Worktree, 'id' | 'repoId' | 'isMainWorktree'>

// Why: selectors must return the same array until the scan or a side changes.
const mergedPortsCache = new WeakMap<WorkspacePort[], WeakMap<WorkspacePort[], WorkspacePort[]>>()

function listenerKey(port: WorkspacePort): string {
  return `${port.connectHost}:${port.port}`
}

/** The holder's own ports plus the root's, deduped by host and port, lowest port first. */
export function mergeSpotlightHolderPorts(
  own: WorkspacePort[],
  root: WorkspacePort[]
): WorkspacePort[] {
  if (root.length === 0) {
    return own
  }
  let byRoot = mergedPortsCache.get(own)
  if (!byRoot) {
    byRoot = new WeakMap()
    mergedPortsCache.set(own, byRoot)
  }
  const cached = byRoot.get(root)
  if (cached) {
    return cached
  }
  const seen = new Set<string>()
  const merged: WorkspacePort[] = []
  for (const port of [...own, ...root]) {
    const key = listenerKey(port)
    if (!seen.has(key)) {
      seen.add(key)
      merged.push(port)
    }
  }
  merged.sort(comparePorts)
  byRoot.set(root, merged)
  return merged
}

/** `:8080`, or `:3000 +1` for several. The configured port leads when it listens, else the lowest. */
export function formatSpotlightPortLabel(
  ports: readonly WorkspacePort[],
  configuredPort?: number
): string | null {
  const numbers = new Set(ports.map((port) => port.port))
  if (numbers.size === 0) {
    return null
  }
  const primary =
    configuredPort !== undefined && numbers.has(configuredPort)
      ? configuredPort
      : Math.min(...numbers)
  return numbers.size > 1 ? `:${primary} +${numbers.size - 1}` : `:${primary}`
}

function holdsSpotlight(state: SpotlightPortsState, row: SpotlightPortsRow): boolean {
  return !row.isMainWorktree && state.spotlightByRepo?.[row.repoId]?.holderWorktreeId === row.id
}

/** Ports the row lists. The row holding its repo's Spotlight also gets the root's, where the
 *  server runs and the scanner attributes it; every other row keeps only its own. */
export function selectRowWorkspacePorts(
  state: SpotlightPortsState,
  row: SpotlightPortsRow
): WorkspacePort[] {
  const portsByWorktree = getWorkspacePortsByWorktreeId(state.workspacePortScan?.result)
  const own = portsByWorktree.get(row.id) ?? EMPTY_WORKSPACE_PORTS
  if (!holdsSpotlight(state, row)) {
    return own
  }
  const rootId = state.worktreesByRepo?.[row.repoId]?.find((entry) => entry.isMainWorktree)?.id
  const root = (rootId ? portsByWorktree.get(rootId) : undefined) ?? EMPTY_WORKSPACE_PORTS
  return mergeSpotlightHolderPorts(own, root)
}

/** Port label of the row holding the repo's Spotlight, or of its root while it is on;
 *  null on every other row and while nothing listens. */
export function selectSpotlightPortLabel(
  state: SpotlightPortsState,
  row: SpotlightPortsRow,
  configuredPort?: number
): string | null {
  if (!state.spotlightByRepo?.[row.repoId]) {
    return null
  }
  if (!row.isMainWorktree && !holdsSpotlight(state, row)) {
    return null
  }
  return formatSpotlightPortLabel(selectRowWorkspacePorts(state, row), configuredPort)
}
