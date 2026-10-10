import type { FolderWorkspace } from '../../../shared/folder-workspace-types'
import type { GlobalSettings } from '../../../shared/global-settings-types'
import type { ProjectGroup } from '../../../shared/project-group-types'
import type { Repo } from '../../../shared/repo-types'
import { getRepoIdFromWorktreeId } from '../../../shared/worktree/id'
import {
  findWorktreeSidebarSpaceId,
  resolveActiveSidebarSpaceId
} from '@/components/sidebar/sidebar-space-scope'

export type ArcSpaceLinkSources = {
  settings?: Partial<
    Pick<GlobalSettings, 'openLinksInArcSpaces' | 'arcSpaceNameBySidebarSpaceId'>
  > | null
  repos?: readonly Pick<Repo, 'id' | 'projectGroupId'>[]
  projectGroups?: readonly ProjectGroup[]
  folderWorkspaces?: readonly Pick<FolderWorkspace, 'id' | 'projectGroupId'>[]
  activeSidebarSpaceGroupId?: string | null
}

/** The Arc space a system-browser link from `worktreeId` opens in, or undefined to open it normally. */
export function resolveArcSpaceForWorktree(
  worktreeId: string | null | undefined,
  sources: ArcSpaceLinkSources | null | undefined
): string | undefined {
  const names = sources?.settings?.arcSpaceNameBySidebarSpaceId
  if (!sources || sources.settings?.openLinksInArcSpaces !== true || !names) {
    return undefined
  }
  const projectGroups = sources.projectGroups ?? []
  const ownSpaceId = worktreeId
    ? findWorktreeSidebarSpaceId(
        { id: worktreeId, repoId: getRepoIdFromWorktreeId(worktreeId) },
        {
          projectGroups,
          repos: sources.repos ?? [],
          folderWorkspaces: sources.folderWorkspaces ?? []
        }
      )
    : null
  // Why the active space: the floating terminal and ungrouped projects belong to no space.
  const spaceId =
    ownSpaceId ??
    resolveActiveSidebarSpaceId(sources.activeSidebarSpaceGroupId ?? null, projectGroups)
  const name = spaceId ? names[spaceId] : undefined
  return name?.trim() || undefined
}
