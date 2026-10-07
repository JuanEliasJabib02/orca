export const MAX_TASK_KEY_LENGTH = 200
export const MAX_TASK_KEYED_ENTRIES = 500
const UNSAFE_RECORD_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

/** Whether a task key may be stored as a key of a ui.json record. */
export function isUsableTaskKey(taskKey: string): boolean {
  return taskKey !== '' && taskKey.length <= MAX_TASK_KEY_LENGTH && !UNSAFE_RECORD_KEYS.has(taskKey)
}
