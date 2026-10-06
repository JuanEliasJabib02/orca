import React from 'react'
import StatusIndicator from '../../StatusIndicator'
import type { TaskSectionInfo } from '../grouping/row-types'
import { useTaskSectionAgentStatus } from './task-section-agent-status'

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
    </>
  )
}
