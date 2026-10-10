import React, { useMemo, useRef } from 'react'
import { Ticket } from 'lucide-react'
import type { Repo } from '../../../../shared/repo-types'
import type { WorkspaceStatus, Worktree } from '../../../../shared/worktree/types'
import { getRepoExecutionHostId } from '../../../../shared/execution-host'
import { isFolderRepo } from '../../../../shared/repo-kind'
import { getWorktreeHostIdentity } from '../../../../shared/worktree/host-qualified-identity'
import { useAppStore } from '@/store'
import { cn } from '@/lib/utils'
import { activateWorktreeFromSidebar } from '@/lib/sidebar-worktree-activation'
import RepoBadgeLabel from '@/components/repo/RepoBadgeLabel'
import type { TaskSectionInfo } from './worktree-list/grouping/row-types'
import { TaskHeaderMenu } from './worktree-list/rows/TaskHeaderMenu'
import { TaskHeaderNoteSurface } from './worktree-list/rows/TaskHeaderNoteSurface'
import { TaskSectionHeader } from './worktree-list/rows/TaskSectionHeader'
import { TaskSpotlightButton } from './worktree-list/rows/TaskSpotlightButton'
import { WorktreeStatusMenuItems } from './WorktreeStatusMenuItems'
import { canHoldSpotlight, SpotlightQuickAction } from './WorktreeCardSpotlightControls'
import { selectSpotlightPortLabel } from './spotlight-holder-ports'
import { isEventTargetInsideCurrentTarget } from './worktree-card-dom-events'
import {
  isSameTaskSectionInfo,
  type WorkspaceKanbanTaskLaneItem
} from './workspace-kanban-lane-items'

type WorkspaceKanbanTaskCardProps = {
  item: WorkspaceKanbanTaskLaneItem
  // Why: the lane virtualizes, so drop-index math reads the card's lane index from the DOM.
  laneIndex: number
  repoMap: Map<string, Repo>
  activeWorktreeIdentity: string | null
  isSelected: boolean
  selectedWorktrees?: readonly Worktree[]
  onActivate: () => void
  onSelectionGesture: (event: React.MouseEvent<HTMLElement>, cardId: string) => boolean
  onAssignWorkspaceStatus?: (worktreeIds: readonly string[], status: WorkspaceStatus) => void
}

// Why: the item is rebuilt on every board change, and the header's Spotlight and agent-status
// memos key on the TaskSectionInfo identity.
function useStableTaskSectionInfo(task: TaskSectionInfo): TaskSectionInfo {
  const stable = useRef(task)
  if (stable.current !== task && !isSameTaskSectionInfo(stable.current, task)) {
    stable.current = task
  }
  return stable.current
}

function WorkspaceKanbanTaskMemberRow({
  worktree,
  repo,
  isActive,
  showWorkspaceName,
  onClick,
  onOpen
}: {
  worktree: Worktree
  repo: Repo | undefined
  isActive: boolean
  /** Set when another member shares the repo, so the two rows stay apart. */
  showWorkspaceName: boolean
  onClick: (event: React.MouseEvent<HTMLElement>, worktree: Worktree) => void
  onOpen: (worktree: Worktree) => void
}): React.JSX.Element {
  const spotlightEligible = repo ? canHoldSpotlight(worktree, repo, isFolderRepo(repo)) : false
  // Why: only the member holding the repo's Spotlight reads a label; the others select null.
  const portLabel = useAppStore((s) =>
    selectSpotlightPortLabel(s, worktree, repo?.spotlightServer?.port)
  )
  return (
    <div
      role="button"
      tabIndex={0}
      data-workspace-board-task-member={worktree.id}
      data-current={isActive ? 'true' : undefined}
      className={cn(
        // Why group/worktree-card: the Spotlight quick action reveals on that group's hover, as on a card.
        'group/worktree-card flex h-6 min-w-0 cursor-pointer items-center gap-1.5 rounded-md px-1.5 text-[12px] text-foreground outline-none transition-colors',
        'hover:bg-worktree-sidebar-accent focus-visible:ring-1 focus-visible:ring-worktree-sidebar-ring',
        isActive && 'bg-worktree-sidebar-accent'
      )}
      onClick={(event) => onClick(event, worktree)}
      onKeyDown={(event) => {
        // Why: keys bubble from the nested Spotlight button, whose own Enter/Space must not open the worktree.
        if (event.target !== event.currentTarget) {
          return
        }
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onOpen(worktree)
        }
      }}
    >
      {repo ? (
        <RepoBadgeLabel name={repo.displayName} color={repo.badgeColor} className="min-w-0" />
      ) : null}
      <span className="min-w-0 flex-1 truncate text-muted-foreground">
        {!repo || showWorkspaceName ? worktree.displayName : null}
      </span>
      {portLabel ? (
        <span
          data-spotlight-port=""
          className="shrink-0 text-[10px] leading-none tabular-nums text-muted-foreground"
        >
          {portLabel}
        </span>
      ) : null}
      {spotlightEligible && repo ? <SpotlightQuickAction worktree={worktree} repo={repo} /> : null}
    </div>
  )
}

/** A Group by → Task card: the task's header, then one row per board-visible member. */
function WorkspaceKanbanTaskCard({
  item,
  laneIndex,
  repoMap,
  activeWorktreeIdentity,
  isSelected,
  selectedWorktrees,
  onActivate,
  onSelectionGesture,
  onAssignWorkspaceStatus
}: WorkspaceKanbanTaskCardProps): React.JSX.Element {
  const task = useStableTaskSectionInfo(item.task)
  const workspaceStatuses = useAppStore((s) => s.workspaceStatuses)
  const sharedRepoIds = useMemo(() => {
    const seen = new Set<string>()
    const shared = new Set<string>()
    for (const worktree of item.worktrees) {
      if (seen.has(worktree.repoId)) {
        shared.add(worktree.repoId)
      }
      seen.add(worktree.repoId)
    }
    return shared
  }, [item.worktrees])
  // Why: inside a wider selection the card moves the whole selection, like a plain card's menu.
  const isMultiContext =
    isSelected &&
    selectedWorktrees !== undefined &&
    selectedWorktrees.length > item.worktrees.length

  const openMember = (worktree: Worktree): void => {
    const repo = repoMap.get(worktree.repoId)
    void activateWorktreeFromSidebar(
      worktree.id,
      worktree.hostId ?? (repo ? getRepoExecutionHostId(repo) : undefined)
    )
    onActivate()
  }
  const handleMemberClick = (event: React.MouseEvent<HTMLElement>, worktree: Worktree): void => {
    // Why: the card's own click is a selection gesture; a row click opens its worktree.
    event.stopPropagation()
    if (!isEventTargetInsideCurrentTarget(event.currentTarget, event.target)) {
      return
    }
    // Why: a modifier click only selects, exactly as on a plain card.
    if (onSelectionGesture(event, item.key)) {
      return
    }
    openMember(worktree)
  }
  const handleCardClick = (event: React.MouseEvent<HTMLDivElement>): void => {
    // Why: Radix portals bubble React clicks through the card; only real card clicks select.
    if (isEventTargetInsideCurrentTarget(event.currentTarget, event.target)) {
      onSelectionGesture(event, item.key)
    }
  }

  return (
    <div
      className={cn(
        'group relative flex flex-col rounded-lg border px-0.5 pb-1 transition-[background-color,border-color,box-shadow]',
        'data-[workspace-board-card-area-selected=true]:ring-1 data-[workspace-board-card-area-selected=true]:ring-worktree-sidebar-ring/40',
        isSelected
          ? 'border-worktree-sidebar-ring/35 bg-worktree-sidebar-accent/70 ring-1 ring-worktree-sidebar-ring/30'
          : 'border-worktree-sidebar-border'
      )}
      data-workspace-board-card-id={item.key}
      // Why the first member: the pointer drag needs a worktree id to start from; the drop expands it.
      data-workspace-board-worktree-id={item.worktrees[0]?.id}
      data-workspace-board-card-index={laneIndex}
      data-workspace-board-card-mode="task"
      data-workspace-board-card-selected={isSelected ? 'true' : 'false'}
      data-workspace-board-pointer-draggable="true"
      onClick={handleCardClick}
    >
      <TaskHeaderNoteSurface task={task}>
        <div className="flex h-7 min-w-0 items-center gap-1.5 px-1.5">
          <Ticket className="size-3 shrink-0 text-muted-foreground" />
          <span className="shrink-0 text-[12px] font-semibold text-foreground">{task.taskKey}</span>
          <span className="min-w-0 flex-1 truncate text-[12px] text-muted-foreground">
            {task.title}
          </span>
          <TaskSectionHeader task={task} actions={<TaskSpotlightButton task={task} />} />
          <TaskHeaderMenu task={task}>
            {onAssignWorkspaceStatus ? (
              <WorktreeStatusMenuItems
                contextWorkspaceStatus={item.status}
                deletingContext={false}
                isMultiContext={isMultiContext}
                onAssignWorkspaceStatus={(status) =>
                  onAssignWorkspaceStatus(
                    isMultiContext
                      ? (selectedWorktrees ?? []).map((worktree) => worktree.id)
                      : item.memberIds,
                    status
                  )
                }
                workspaceStatuses={workspaceStatuses}
              />
            ) : null}
          </TaskHeaderMenu>
        </div>
      </TaskHeaderNoteSurface>
      <div className="flex flex-col gap-0.5">
        {item.worktrees.map((worktree) => {
          const identity = getWorktreeHostIdentity(worktree)
          return (
            <WorkspaceKanbanTaskMemberRow
              key={identity}
              worktree={worktree}
              repo={repoMap.get(worktree.repoId)}
              isActive={activeWorktreeIdentity === identity}
              showWorkspaceName={sharedRepoIds.has(worktree.repoId)}
              onClick={handleMemberClick}
              onOpen={openMember}
            />
          )
        })}
      </div>
    </div>
  )
}

export default React.memo(WorkspaceKanbanTaskCard)
