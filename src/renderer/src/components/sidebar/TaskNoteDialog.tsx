import React, { useCallback, useId, useRef, useState } from 'react'
import { useAppStore } from '@/store'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { translate } from '@/i18n/i18n'
import { isScreenSubmitShortcut } from '@/lib/screen-submit-shortcut'
import { getTaskNote, MAX_TASK_NOTE_LENGTH } from '@/store/slices/ui/ui-slice-task-note-actions'

/** Edits the private note of the task named by the `edit-task-note` modal; saving it empty removes the note. */
const TaskNoteDialog = React.memo(function TaskNoteDialog() {
  const activeModal = useAppStore((s) => s.activeModal)
  const modalData = useAppStore((s) => s.modalData)
  const closeModal = useAppStore((s) => s.closeModal)
  const setTaskNote = useAppStore((s) => s.setTaskNote)
  const taskKey = typeof modalData.taskKey === 'string' ? modalData.taskKey : ''
  const savedNote = useAppStore((s) => getTaskNote(s.taskNoteByTaskKey, taskKey)) ?? ''
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const textareaId = useId()
  // Why: the sidebar mounts this only while the modal is open, so the draft seeds once per open.
  const [draft, setDraft] = useState(savedNote)

  const handleSave = useCallback(() => {
    if (taskKey !== '') {
      setTaskNote(taskKey, draft)
    }
    closeModal()
  }, [closeModal, draft, setTaskNote, taskKey])

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      const isPlainEnter =
        event.key === 'Enter' &&
        !event.shiftKey &&
        !event.altKey &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.nativeEvent.isComposing
      // Why: Enter saves like the worktree comment field; Shift+Enter keeps a line break.
      if (isPlainEnter || isScreenSubmitShortcut(event)) {
        event.preventDefault()
        handleSave()
      }
    },
    [handleSave]
  )

  return (
    <Dialog
      open={activeModal === 'edit-task-note'}
      onOpenChange={(open) => {
        if (!open) {
          closeModal()
        }
      }}
    >
      <DialogContent
        className="max-w-sm sm:max-w-sm"
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          const textarea = textareaRef.current
          textarea?.focus()
          textarea?.setSelectionRange(textarea.value.length, textarea.value.length)
        }}
      >
        <DialogHeader>
          <DialogTitle>
            {translate('auto.components.sidebar.TaskNoteDialog.title', 'Note for {{task}}', {
              task: taskKey
            })}
          </DialogTitle>
          <DialogDescription>
            {translate(
              'auto.components.sidebar.TaskNoteDialog.description',
              'Kept only in Orca, never written to Jira or your repos. Shown when you hover the task header. Save it empty to remove it.'
            )}
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault()
            handleSave()
          }}
        >
          <div className="space-y-1">
            <Label htmlFor={textareaId}>
              {translate('auto.components.sidebar.TaskNoteDialog.label', 'Note')}
            </Label>
            <Textarea
              id={textareaId}
              ref={textareaRef}
              value={draft}
              maxLength={MAX_TASK_NOTE_LENGTH}
              rows={3}
              placeholder={translate(
                'auto.components.sidebar.TaskNoteDialog.placeholder',
                'e.g. POS Action Wear'
              )}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={handleKeyDown}
              className="resize-none"
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" size="sm" onClick={closeModal}>
              {translate('auto.components.sidebar.TaskNoteDialog.cancel', 'Cancel')}
            </Button>
            <Button type="submit" size="sm">
              {translate('auto.components.sidebar.TaskNoteDialog.save', 'Save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
})

export default TaskNoteDialog
