import { useMemo } from 'react'
import { useAppStore } from '@/store'
import { useProjectHostSetupProjection } from '@/store/selectors'
import type { ProjectGroup } from '../../../../shared/project-group-types'
import type { Repo } from '../../../../shared/repo-types'
import { getLogicalRepoOrderRankById } from './project-header-drop'
import { buildProjectGroupingIndex } from './worktree-list/grouping/project-grouping'
import type { WorkspaceKanbanProjectSections } from './workspace-kanban-project-sections'

const EMPTY_PROJECT_GROUPS: readonly ProjectGroup[] = []

/** The sidebar's project inputs for Group by → Project; null in every other mode. */
export function useWorkspaceKanbanProjectSections(
  enabled: boolean,
  repoMap: Map<string, Repo>
): WorkspaceKanbanProjectSections | null {
  const projection = useProjectHostSetupProjection()
  const projectGroups = useAppStore((s) => s.projectGroups ?? EMPTY_PROJECT_GROUPS)
  const projectOrderBy = useAppStore((s) => s.projectOrderBy)
  const repos = useAppStore((s) => s.repos)
  return useMemo(
    () =>
      enabled
        ? {
            repoMap,
            projectIndex: buildProjectGroupingIndex({
              projects: projection.projects,
              projectHostSetups: projection.setups
            }),
            projectGroups,
            projectOrderBy,
            // Why: manual project order is bound to the store's repo list, as in the sidebar.
            repoOrder: getLogicalRepoOrderRankById(repos.map((repo) => repo.id))
          }
        : null,
    [enabled, projectGroups, projectOrderBy, projection, repoMap, repos]
  )
}
