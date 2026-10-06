import type { FolderWorkspace } from '../../../../shared/folder-workspace-types'
import type { ProjectGroup } from '../../../../shared/project-group-types'
import type { Repo } from '../../../../shared/repo-types'
import type { Worktree } from '../../../../shared/worktree/types'
import { getRepoExecutionHostId, type ExecutionHostId } from '../../../../shared/execution-host'
import { parseWorkspaceKey } from '../../../../shared/workspace-scope'
import type { AppState } from '@/store/types'

/** What belongs to the active space: its group's subtree and the projects filed under it. */
export type SidebarSpaceScope = {
  groupIds: ReadonlySet<string>
  repoIds: ReadonlySet<string>
  folderWorkspaceIds: ReadonlySet<string>
}

/** `null` means "All": no active space, or the active group is gone or no longer top-level. */
export function resolveSidebarSpaceScope(args: {
  activeGroupId: string | null
  projectGroups: readonly ProjectGroup[]
  repos: readonly Repo[]
  folderWorkspaces: readonly FolderWorkspace[]
}): SidebarSpaceScope | null {
  const { activeGroupId, projectGroups, repos, folderWorkspaces } = args
  // Why top-level only: a group nested via "Move to group" has no switcher entry to leave it by.
  if (
    activeGroupId === null ||
    !projectGroups.some((group) => group.id === activeGroupId && group.parentGroupId === null)
  ) {
    return null
  }

  const childIdsByParentId = new Map<string, string[]>()
  for (const group of projectGroups) {
    if (group.parentGroupId === null) {
      continue
    }
    const siblings = childIdsByParentId.get(group.parentGroupId)
    if (siblings) {
      siblings.push(group.id)
    } else {
      childIdsByParentId.set(group.parentGroupId, [group.id])
    }
  }

  // Why the visited set: corrupt parent links (e.g. duplicate ids) must terminate instead of looping.
  const groupIds = new Set<string>([activeGroupId])
  const queue = [activeGroupId]
  for (const groupId of queue) {
    for (const childId of childIdsByParentId.get(groupId) ?? []) {
      if (!groupIds.has(childId)) {
        groupIds.add(childId)
        queue.push(childId)
      }
    }
  }

  const knownGroupIds = new Set(projectGroups.map((group) => group.id))
  const repoIds = new Set<string>()
  for (const repo of repos) {
    // Why spaceless repos join every space: there is no All view, so this keeps them reachable.
    if (isSpacelessRepo(repo, knownGroupIds) || groupIds.has(repo.projectGroupId ?? '')) {
      repoIds.add(repo.id)
    }
  }
  const folderWorkspaceIds = new Set<string>()
  for (const folderWorkspace of folderWorkspaces) {
    if (groupIds.has(folderWorkspace.projectGroupId)) {
      folderWorkspaceIds.add(folderWorkspace.id)
    }
  }
  return { groupIds, repoIds, folderWorkspaceIds }
}

export function resolveSidebarSpaceScopeFromState(
  state: Pick<
    AppState,
    'activeSidebarSpaceGroupId' | 'projectGroups' | 'repos' | 'folderWorkspaces'
  >
): SidebarSpaceScope | null {
  // Why early return: skips the group walk in the common "All" case and in partial test states.
  if (!state.activeSidebarSpaceGroupId) {
    return null
  }
  return resolveSidebarSpaceScope({
    activeGroupId: state.activeSidebarSpaceGroupId,
    projectGroups: state.projectGroups,
    repos: state.repos,
    folderWorkspaces: state.folderWorkspaces
  })
}

export function isWorktreeInSidebarSpace(
  worktree: Pick<Worktree, 'id' | 'repoId'>,
  scope: SidebarSpaceScope
): boolean {
  if (scope.repoIds.has(worktree.repoId)) {
    return true
  }
  // Why the key parse: a folder workspace's synthetic repoId names its group, not a repo.
  const workspaceScope = parseWorkspaceKey(worktree.id)
  return (
    workspaceScope?.type === 'folder' &&
    scope.folderWorkspaceIds.has(workspaceScope.folderWorkspaceId)
  )
}

// Why shared: the rendered sidebar and the Cmd+1–9 order fallback must narrow identically.
export function filterProjectGroupsToSidebarSpace(
  projectGroups: readonly ProjectGroup[],
  scope: SidebarSpaceScope | null
): readonly ProjectGroup[] {
  return scope ? projectGroups.filter((group) => scope.groupIds.has(group.id)) : projectGroups
}

export function filterFolderWorkspacesToSidebarSpace(
  folderWorkspaces: readonly FolderWorkspace[],
  scope: SidebarSpaceScope | null
): readonly FolderWorkspace[] {
  return scope
    ? folderWorkspaces.filter((workspace) => scope.folderWorkspaceIds.has(workspace.id))
    : folderWorkspaces
}

/** Top-level groups in switcher order. */
export function listSidebarSpaces(projectGroups: readonly ProjectGroup[]): ProjectGroup[] {
  return projectGroups
    .filter((group) => group.parentGroupId === null)
    .sort((a, b) => a.tabOrder - b.tabOrder)
}

/** The space the switcher shows as active: the stored one if it is still a space, else the first. */
export function resolveActiveSidebarSpaceId(
  activeGroupId: string | null,
  projectGroups: readonly ProjectGroup[]
): string | null {
  const spaces = listSidebarSpaces(projectGroups)
  return spaces.find((space) => space.id === activeGroupId)?.id ?? spaces[0]?.id ?? null
}

/** A repo with no group, or whose group was deleted, belongs to no space. */
export function isSpacelessRepo(
  repo: Pick<Repo, 'projectGroupId'>,
  knownGroupIds: ReadonlySet<string>
): boolean {
  return !repo.projectGroupId || !knownGroupIds.has(repo.projectGroupId)
}

/** Spaceless repos on one host, in store order: what the first space adopts when it is created. */
export function listSpacelessRepoIdsOnHost(
  repos: readonly Repo[],
  projectGroups: readonly ProjectGroup[],
  hostId: ExecutionHostId
): string[] {
  const knownGroupIds = new Set(projectGroups.map((group) => group.id))
  return repos
    .filter(
      (repo) => isSpacelessRepo(repo, knownGroupIds) && getRepoExecutionHostId(repo) === hostId
    )
    .map((repo) => repo.id)
}
