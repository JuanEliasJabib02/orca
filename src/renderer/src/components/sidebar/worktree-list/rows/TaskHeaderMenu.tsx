import React, { useMemo } from 'react'
import { Ellipsis, Trash2 } from 'lucide-react'
import { useAppStore } from '@/store'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { translate } from '@/i18n/i18n'
import { runWorktreeBatchDelete } from '../../delete-worktree-flow'
import { REPO_HEADER_ACTION_BUTTON_CLASS } from '../../repo-header-action-button-class'
import type { TaskSectionInfo } from '../grouping/row-types'
import {
  handleRepoHeaderActionPointerDown,
  stopRepoHeaderKeyboardToggle,
  stopRepoHeaderMenuEvent
} from './header-event-guards'
import { resolveTaskDeleteTargets } from './task-delete-targets'

/** `⋯` menu of a Group by → Task header: actions on the whole task across repos. */
export function TaskHeaderMenu({ task }: { task: TaskSectionInfo }): React.JSX.Element | null {
  const { taskKey } = task
  const worktreesByRepo = useAppStore((s) => s.worktreesByRepo)
  const targets = useMemo(
    () => resolveTaskDeleteTargets(task, worktreesByRepo),
    [task, worktreesByRepo]
  )

  // Why null: the "No task" section has no task to act on.
  if (taskKey === null) {
    return null
  }

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className={REPO_HEADER_ACTION_BUTTON_CLASS}
          data-repo-header-action=""
          aria-label={translate(
            'auto.components.sidebar.TaskHeaderMenu.actionsFor',
            'Task actions for {{task}}',
            { task: taskKey }
          )}
          onClick={(event) => event.stopPropagation()}
          onKeyDown={stopRepoHeaderKeyboardToggle}
          onPointerDown={handleRepoHeaderActionPointerDown}
        >
          <Ellipsis className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        side="bottom"
        sideOffset={6}
        // Why: Radix portals keep React bubbling through the task header; block menu events from arming row drag/collapse.
        onPointerDown={stopRepoHeaderMenuEvent}
        onMouseDown={stopRepoHeaderMenuEvent}
        onPointerUp={stopRepoHeaderMenuEvent}
        onMouseUp={stopRepoHeaderMenuEvent}
        onClick={stopRepoHeaderMenuEvent}
        onKeyDown={stopRepoHeaderMenuEvent}
      >
        <DropdownMenuItem
          variant="destructive"
          disabled={targets.length === 0}
          // Why forceConfirm: deleting a task must confirm even when it holds one worktree and the user skips single-delete prompts.
          onSelect={() => runWorktreeBatchDelete(targets, { forceConfirm: true })}
        >
          <Trash2 className="size-3.5" />
          {translate('auto.components.sidebar.TaskHeaderMenu.deleteTask', 'Delete task…')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
