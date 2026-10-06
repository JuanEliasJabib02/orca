import type { FolderWorkspace } from '../../../../shared/folder-workspace-types'
import type { ProjectGroup } from '../../../../shared/project-group-types'
import type { Repo } from '../../../../shared/repo-types'
import type { Worktree } from '../../../../shared/worktree/types'
import { folderWorkspaceKey } from '../../../../shared/workspace-scope'
import type { LiveAgentWorktreeStatus } from '@/lib/worktree-activity-state'

/** `permission` (an agent is waiting on the user) outranks `unread` (finished, not yet seen). */
export type SidebarSpaceAttention = 'permission' | 'unread'

/** Only the fields the rollup reads, so callers and tests can pass narrow projections. */
export type SidebarSpaceAttentionSources = {
  projectGroups: readonly Pick<ProjectGroup, 'id' | 'parentGroupId'>[]
  repos: readonly Pick<Repo, 'id' | 'projectGroupId'>[]
  folderWorkspaces: readonly Pick<
    FolderWorkspace,
    'id' | 'projectGroupId' | 'isUnread' | 'isArchived'
  >[]
  worktreesByRepo: Readonly<
    Record<string, readonly Pick<Worktree, 'id' | 'repoId' | 'isUnread' | 'isArchived'>[]>
  >
  tabsByWorktree: Readonly<Record<string, readonly { id: string }[]>>
  unreadTerminalTabs: Readonly<Record<string, unknown>>
  liveAgentStatusByWorktreeId: ReadonlyMap<string, LiveAgentWorktreeStatus>
}

/**
 * Maps every group to its top-level ancestor. A group on a parent cycle or under a missing parent
 * has no entry, so its projects belong to no space.
 */
function resolveTopLevelGroupIds(
  projectGroups: SidebarSpaceAttentionSources['projectGroups']
): Map<string, string> {
  const parentIdByGroupId = new Map<string, string | null>()
  for (const group of projectGroups) {
    parentIdByGroupId.set(group.id, group.parentGroupId)
  }
  const topLevelGroupIdByGroupId = new Map<string, string>()
  for (const group of projectGroups) {
    // Why the visited set: a revisited id is a cycle and a missing parent ends the walk, so neither loops.
    const visited = new Set<string>()
    let currentId: string | null | undefined = group.id
    while (currentId != null && !visited.has(currentId)) {
      visited.add(currentId)
      const parentId = parentIdByGroupId.get(currentId)
      if (parentId === null) {
        topLevelGroupIdByGroupId.set(group.id, currentId)
        break
      }
      currentId = parentId
    }
  }
  return topLevelGroupIdByGroupId
}

/**
 * Top-level group id to what needs the user inside it; a space with nothing is absent. Permission is
 * a live agent waiting on input (the sidebar's `permission` state); unread mirrors the Dock badge:
 * a flagged workspace or an unread terminal tab. Workspaces in no space are ignored.
 */
export function rollUpSidebarSpaceAttention(
  sources: SidebarSpaceAttentionSources
): ReadonlyMap<string, SidebarSpaceAttention> {
  const topLevelGroupIdByGroupId = resolveTopLevelGroupIds(sources.projectGroups)

  const spaceIdByRepoId = new Map<string, string>()
  for (const repo of sources.repos) {
    const spaceId = repo.projectGroupId ? topLevelGroupIdByGroupId.get(repo.projectGroupId) : null
    if (spaceId) {
      spaceIdByRepoId.set(repo.id, spaceId)
    }
  }

  const attentionBySpaceId = new Map<string, SidebarSpaceAttention>()
  const raise = (spaceId: string, attention: SidebarSpaceAttention): void => {
    if (attention === 'permission' || !attentionBySpaceId.has(spaceId)) {
      attentionBySpaceId.set(spaceId, attention)
    }
  }

  // Why archived workspaces never enter this map: they are gone from the sidebar, so they cannot light a space.
  const spaceIdByWorktreeId = new Map<string, string>()
  for (const worktrees of Object.values(sources.worktreesByRepo)) {
    for (const worktree of worktrees) {
      const spaceId = spaceIdByRepoId.get(worktree.repoId)
      if (worktree.isArchived || !spaceId) {
        continue
      }
      spaceIdByWorktreeId.set(worktree.id, spaceId)
      if (worktree.isUnread) {
        raise(spaceId, 'unread')
      }
    }
  }
  for (const folderWorkspace of sources.folderWorkspaces) {
    const spaceId = topLevelGroupIdByGroupId.get(folderWorkspace.projectGroupId)
    if (folderWorkspace.isArchived || !spaceId) {
      continue
    }
    spaceIdByWorktreeId.set(folderWorkspaceKey(folderWorkspace.id), spaceId)
    if (folderWorkspace.isUnread) {
      raise(spaceId, 'unread')
    }
  }

  for (const [worktreeId, status] of sources.liveAgentStatusByWorktreeId) {
    const spaceId = spaceIdByWorktreeId.get(worktreeId)
    if (status === 'permission' && spaceId) {
      raise(spaceId, 'permission')
    }
  }

  // Why unmatched ids are dropped, unlike the Dock badge: with no workspace there is no space to flag.
  const unreadTabIds = new Set(Object.keys(sources.unreadTerminalTabs))
  if (unreadTabIds.size > 0) {
    for (const [worktreeId, tabs] of Object.entries(sources.tabsByWorktree)) {
      const spaceId = spaceIdByWorktreeId.get(worktreeId)
      if (spaceId && tabs.some((tab) => unreadTabIds.has(tab.id))) {
        raise(spaceId, 'unread')
      }
    }
  }
  return attentionBySpaceId
}
