import React from 'react'
import StatusIndicator from '../../workspace-card/surface/StatusIndicator'
import type { TaskSectionInfo } from '../../../../../../shared/sidebar-list/row-types'
import { useTaskSectionAgentStatus } from './task-section-agent-status'
import { TaskSpotlightEnvPill } from './TaskSpotlightEnvPill'
import { TaskSpotlightButton } from './TaskSpotlightButton'
import { TaskTestTurnBadge } from './TaskTestTurnBadge'

export type TaskSectionHeaderProps = {
  task: TaskSectionInfo
  /** Whole-task actions (e.g. Spotlight the task). Always visible, unlike the hover-only header actions. */
  actions?: React.ReactNode
}

/** Task-only parts of a Group by → Task header, rendered after its label. */
export function TaskSectionHeader({ task, actions }: TaskSectionHeaderProps): React.JSX.Element {
  const status = useTaskSectionAgentStatus(task)
  return (
    <>
      {status ? <StatusIndicator status={status} data-task-section-status={status} /> : null}
      {actions ? (
        // Why data-repo-header-action: a click in the slot's gutter must not toggle the section.
        <div
          data-task-section-actions=""
          data-repo-header-action=""
          className="flex shrink-0 items-center gap-0.5 empty:hidden"
        >
          {actions}
        </div>
      ) : null}
      <TaskTestTurnBadge taskKey={task.taskKey} />
      {task.taskKey !== null ? <TaskSpotlightEnvPill task={task} /> : null}
    </>
  )
}

/** The sidebar section header's task parts: a keyed task can be Spotlighted, "No task"/"Servers" not. */
export function SidebarTaskSectionHeader({ task }: { task: TaskSectionInfo }): React.JSX.Element {
  return (
    <TaskSectionHeader
      task={task}
      actions={task.taskKey ? <TaskSpotlightButton task={task} /> : undefined}
    />
  )
}
