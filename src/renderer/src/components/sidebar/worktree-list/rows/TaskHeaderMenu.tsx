import React, { useMemo } from 'react'
import { Ellipsis, StickyNote, Trash2 } from 'lucide-react'
import { useAppStore } from '@/store'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { translate } from '@/i18n/i18n'
import { getTaskNote } from '@/store/slices/ui/ui-slice-task-note-actions'
import { runWorktreeBatchDelete } from '../../delete-worktree-flow'
import { REPO_HEADER_ACTION_BUTTON_CLASS } from '../../repo-header-action-button-class'
import type { TaskSectionInfo } from '../grouping/row-types'
import {
  handleRepoHeaderActionPointerDown,
  stopRepoHeaderKeyboardToggle,
  stopRepoHeaderMenuEvent
} from './header-event-guards'
import { resolveTaskDeleteTargets } from './task-delete-targets'
import { getTaskNoteActionLabel } from './task-note-action-label'
import { createTaskDeleteCompletion } from './task-note-delete-cleanup'

/** `⋯` menu of a Group by → Task header: actions on the whole task across repos. */
export function TaskHeaderMenu({ task }: { task: TaskSectionInfo }): React.JSX.Element | null {
  const { taskKey } = task
  const worktreesByRepo = useAppStore((s) => s.worktreesByRepo)
  const note = useAppStore((s) => getTaskNote(s.taskNoteByTaskKey, taskKey))
  const openModal = useAppStore((s) => s.openModal)
  const setTaskNote = useAppStore((s) => s.setTaskNote)
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
        <DropdownMenuItem onSelect={() => openModal('edit-task-note', { taskKey })}>
          <StickyNote className="size-3.5" />
          {getTaskNoteActionLabel(note !== null)}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          disabled={targets.length === 0}
          onSelect={() =>
            runWorktreeBatchDelete(targets, {
              // Why forceConfirm: deleting a task must confirm even when it holds one worktree and the user skips single-delete prompts.
              forceConfirm: true,
              // Why: the note outlives a partial delete; it goes only once the task's last worktree is gone.
              onDeleted: createTaskDeleteCompletion(targets, () => setTaskNote(taskKey, ''))
            })
          }
        >
          <Trash2 className="size-3.5" />
          {translate('auto.components.sidebar.TaskHeaderMenu.deleteTask', 'Delete task…')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
