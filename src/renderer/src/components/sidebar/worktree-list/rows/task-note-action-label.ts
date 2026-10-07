import { translate } from '@/i18n/i18n'

/** Label of the note action in a task header's menus: "Add" until the task has a note. */
export function getTaskNoteActionLabel(hasNote: boolean): string {
  return hasNote
    ? translate('auto.components.sidebar.TaskNoteActionLabel.edit', 'Edit note…')
    : translate('auto.components.sidebar.TaskNoteActionLabel.add', 'Add note…')
}
