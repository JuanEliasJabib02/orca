import type { FolderWorkspace } from './folder-workspaces/folder-workspace-types'
import { projectGroupIdFromRepoId } from './folder-workspaces/folder-workspace-worktree'
import type { ProjectGroup } from './project-group-types'
import type { Repo } from './repo-types'
import { parseWorkspaceKey } from './workspace-scope'
import { getRepoIdFromWorktreeId } from './worktree/id'
import type { Worktree } from './worktree/types'

/** The lane every project outside a space shares: one test turn for all of them. */
export const SPACELESS_LANE_KEY = 'spaceless'

export type ProjectGroupSpaceSources = {
  projectGroups: readonly Pick<ProjectGroup, 'id' | 'parentGroupId'>[]
  repos: readonly Pick<Repo, 'id' | 'projectGroupId'>[]
  folderWorkspaces: readonly Pick<FolderWorkspace, 'id' | 'projectGroupId'>[]
}

/** The space (top-level group) a group sits under; null for an unknown group or a broken chain. */
export function findTopLevelGroupId(
  groupId: string,
  projectGroups: readonly Pick<ProjectGroup, 'id' | 'parentGroupId'>[]
): string | null {
  const groupById = new Map(projectGroups.map((group) => [group.id, group]))
  const visited = new Set<string>()
  let current = groupById.get(groupId)
  while (current && !visited.has(current.id)) {
    if (current.parentGroupId === null) {
      return current.id
    }
    visited.add(current.id)
    current = groupById.get(current.parentGroupId)
  }
  return null
}

/** The space (top-level group id) holding a worktree's project, or null when it belongs to none. */
export function findWorktreeSidebarSpaceId(
  worktree: Pick<Worktree, 'id' | 'repoId'>,
  sources: ProjectGroupSpaceSources
): string | null {
  const workspaceScope = parseWorkspaceKey(worktree.id)
  const groupId =
    workspaceScope?.type === 'folder'
      ? sources.folderWorkspaces.find((fw) => fw.id === workspaceScope.folderWorkspaceId)
          ?.projectGroupId
      : sources.repos.find((repo) => repo.id === worktree.repoId)?.projectGroupId
  return groupId ? findTopLevelGroupId(groupId, sources.projectGroups) : null
}

/** The test lane of a worktree: its space, or the one lane spaceless projects share. */
export function laneKeyOf(worktreeId: string, sources: ProjectGroupSpaceSources): string {
  const repoId = getRepoIdFromWorktreeId(worktreeId)
  // Why: a folder workspace's synthetic project id names its group, not a repo.
  const folderGroupId = projectGroupIdFromRepoId(repoId)
  const spaceId = folderGroupId
    ? findTopLevelGroupId(folderGroupId, sources.projectGroups)
    : findWorktreeSidebarSpaceId({ id: worktreeId, repoId }, sources)
  return spaceId ?? SPACELESS_LANE_KEY
}
