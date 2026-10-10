import React from 'react'
import { FolderTree } from 'lucide-react'
import { RepoBadgeMark } from '@/components/repo/RepoBadgeLabel'
import type { WorkspaceKanbanProjectHeaderLaneItem } from './workspace-kanban-lane-items'

/**
 * A Group by → Project sub-header inside a lane. Deliberately not a card: no card id, so drag,
 * selection and drop-index code never see it.
 */
function WorkspaceKanbanProjectHeader({
  item
}: {
  item: WorkspaceKanbanProjectHeaderLaneItem
}): React.JSX.Element {
  return (
    <div
      data-workspace-board-project-header={item.projectKey}
      className="flex h-6 min-w-0 items-center gap-1.5 px-2 text-[11px] font-semibold text-muted-foreground"
    >
      {item.repo ? (
        <RepoBadgeMark color={item.repo.badgeColor} />
      ) : (
        <FolderTree className="size-3 shrink-0" />
      )}
      <span className="min-w-0 truncate">{item.label}</span>
      <span className="shrink-0 font-medium tabular-nums">{item.count}</span>
    </div>
  )
}

export default React.memo(WorkspaceKanbanProjectHeader)
