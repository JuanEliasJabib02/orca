import React from 'react'

import { projectGroupIdFromRepoId } from '../../../../shared/folder-workspace-worktree'
import type { ProjectGroup } from '../../../../shared/project-group-types'
import type { Repo } from '../../../../shared/repo-types'
import { cn } from '@/lib/utils'
import { TruncatedSidebarLabel } from './truncated-sidebar-label'
import type { WorktreeGroupBy } from './worktree-list/grouping/row-types'

// Why: outside Project grouping no section header names the project, so the card must.
export function getWorktreeCardProjectLabel(args: {
  groupBy: WorktreeGroupBy
  affiliateListMode: boolean
  repo: Pick<Repo, 'displayName'> | undefined
  worktreeRepoId: string
  projectGroups: readonly Pick<ProjectGroup, 'id' | 'name'>[]
}): string | null {
  // Why: the right-sidebar affiliate list is not the grouped sidebar, so its grouping never applies.
  if (args.groupBy === 'repo' || args.affiliateListMode) {
    return null
  }
  if (args.repo) {
    return args.repo.displayName.trim() || null
  }
  // Why: a folder workspace has no repo; its synthetic repoId names the owning project group.
  const projectGroupId = projectGroupIdFromRepoId(args.worktreeRepoId)
  const group = projectGroupId
    ? args.projectGroups.find((candidate) => candidate.id === projectGroupId)
    : undefined
  return group?.name.trim() || null
}

export function WorktreeCardProjectLabel({
  label,
  tooltipEnabled,
  className
}: {
  label: string
  tooltipEnabled: boolean
  className?: string
}): React.JSX.Element {
  return (
    <span className={cn('flex min-w-0', className)} data-worktree-card-project-label="">
      <TruncatedSidebarLabel
        text={label}
        className="text-[11px] leading-none text-muted-foreground opacity-70"
        tooltipEnabled={tooltipEnabled}
      />
    </span>
  )
}
