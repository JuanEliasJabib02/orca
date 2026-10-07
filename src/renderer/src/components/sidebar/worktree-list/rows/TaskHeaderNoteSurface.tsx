import React, { useState } from 'react'
import { StickyNote } from 'lucide-react'
import { useAppStore } from '@/store'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger
} from '@/components/ui/context-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { getTaskNote } from '@/store/slices/ui/ui-slice-task-note-actions'
import type { TaskSectionInfo } from '../grouping/row-types'
import { stopRepoHeaderMenuEvent } from './header-event-guards'
import { getTaskNoteActionLabel } from './task-note-action-label'

/** Makes a Group by → Task header show the task's private note on hover and edit it from a right-click. */
export function TaskHeaderNoteSurface({
  task,
  children
}: {
  task: TaskSectionInfo | undefined
  /** The header row; it receives the hover and right-click handlers, no wrapper element is added. */
  children: React.ReactElement
}): React.JSX.Element {
  const taskKey = task?.taskKey ?? null
  const note = useAppStore((s) => getTaskNote(s.taskNoteByTaskKey, taskKey))
  const openModal = useAppStore((s) => s.openModal)
  const [menuOpen, setMenuOpen] = useState(false)

  // Why: only real tasks carry notes; every other header renders untouched.
  if (taskKey === null) {
    return children
  }

  return (
    <ContextMenu onOpenChange={setMenuOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
        </TooltipTrigger>
        {/* Why no content without a note: the tooltip stays mounted so adding a note never remounts the header. */}
        {note !== null && !menuOpen ? (
          <TooltipContent
            side="right"
            sideOffset={8}
            className="max-w-72 whitespace-pre-wrap break-words"
          >
            {note}
          </TooltipContent>
        ) : null}
      </Tooltip>
      <ContextMenuContent
        // Why: Radix portals keep React bubbling through the sidebar list; block menu events from arming row drag/collapse or list keyboard navigation.
        onPointerDown={stopRepoHeaderMenuEvent}
        onMouseDown={stopRepoHeaderMenuEvent}
        onPointerUp={stopRepoHeaderMenuEvent}
        onMouseUp={stopRepoHeaderMenuEvent}
        onClick={stopRepoHeaderMenuEvent}
        onKeyDown={stopRepoHeaderMenuEvent}
      >
        <ContextMenuItem onSelect={() => openModal('edit-task-note', { taskKey })}>
          <StickyNote className="size-3.5" />
          {getTaskNoteActionLabel(note !== null)}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
