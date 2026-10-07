import type { UISlice, UISliceGet, UISliceSet } from './ui-slice-contract'
import { isUsableTaskKey, MAX_TASK_KEYED_ENTRIES } from './ui-slice-task-key-record'

export const MAX_TASK_NOTE_LENGTH = 500

/** The note as stored: trimmed and capped; null when nothing is left to keep. */
export function normalizeTaskNote(note: unknown): string | null {
  if (typeof note !== 'string') {
    return null
  }
  const normalized = note.trim().slice(0, MAX_TASK_NOTE_LENGTH).trimEnd()
  return normalized === '' ? null : normalized
}

/** Keeps non-empty notes under usable task keys; ui.json is hand-editable and may come from another build. */
export function sanitizeTaskNoteByTaskKey(value: unknown): Record<string, string> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }
  const sanitized: Record<string, string> = {}
  let count = 0
  for (const [taskKey, note] of Object.entries(value)) {
    if (count >= MAX_TASK_KEYED_ENTRIES) {
      break
    }
    const normalized = normalizeTaskNote(note)
    if (isUsableTaskKey(taskKey) && normalized !== null) {
      sanitized[taskKey] = normalized
      count += 1
    }
  }
  return sanitized
}

/** The private note of a task; null when it has none. */
export function getTaskNote(
  taskNoteByTaskKey: Readonly<Record<string, string>>,
  taskKey: string | null
): string | null {
  if (taskKey === null || !Object.hasOwn(taskNoteByTaskKey, taskKey)) {
    return null
  }
  return normalizeTaskNote(taskNoteByTaskKey[taskKey])
}

export function createUiTaskNoteActions(set: UISliceSet, _get: UISliceGet): Partial<UISlice> {
  return {
    taskNoteByTaskKey: {},
    setTaskNote: (taskKey, note) =>
      set((s) => {
        if (!isUsableTaskKey(taskKey)) {
          return s
        }
        const normalized = normalizeTaskNote(note)
        const current = getTaskNote(s.taskNoteByTaskKey, taskKey)
        if (normalized === current) {
          return s
        }
        // Why: hydration drops entries past the cap, so a note added beyond it would vanish on restart.
        if (current === null && Object.keys(s.taskNoteByTaskKey).length >= MAX_TASK_KEYED_ENTRIES) {
          return s
        }
        const next = { ...s.taskNoteByTaskKey }
        if (normalized === null) {
          delete next[taskKey]
        } else {
          next[taskKey] = normalized
        }
        window.api.ui.set({ taskNoteByTaskKey: next }).catch(console.error)
        return { taskNoteByTaskKey: next }
      })
  }
}
