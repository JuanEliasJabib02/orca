import { isSafeSpotlightVariant } from '../../../../../shared/spotlight-server-variant'
import type { UISlice, UISliceGet, UISliceSet } from './ui-slice-contract'
import {
  isUsableTaskKey,
  MAX_TASK_KEY_LENGTH,
  MAX_TASK_KEYED_ENTRIES
} from './ui-slice-task-key-record'

const VARIANT_KEY_SEPARATOR = '::'
// An env key (bounded like a task key) plus a repo id.
const MAX_VARIANT_KEY_LENGTH = MAX_TASK_KEY_LENGTH * 2

// Why the separator check: it also rules out `__proto__` and friends, which never contain `::`.
function isUsableVariantKey(key: string): boolean {
  return key.length <= MAX_VARIANT_KEY_LENGTH && key.includes(VARIANT_KEY_SEPARATOR)
}

/** Where a task's variant for one repo is stored: `<envKey>::<repoId>`, the env key being the one
 *  the task's environment uses. Null when either part can't be stored. */
export function toSpotlightVariantKey(envKey: string | null, repoId: string): string | null {
  if (envKey === null || !isUsableTaskKey(envKey) || repoId === '') {
    return null
  }
  const key = `${envKey}${VARIANT_KEY_SEPARATOR}${repoId}`
  return isUsableVariantKey(key) ? key : null
}

/** Keeps safe variants under usable keys; ui.json is hand-editable and may come from another build. */
export function sanitizeSpotlightVariantByTaskRepo(value: unknown): Record<string, string> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }
  const sanitized: Record<string, string> = {}
  let count = 0
  for (const [key, variant] of Object.entries(value)) {
    if (count >= MAX_TASK_KEYED_ENTRIES) {
      break
    }
    if (isUsableVariantKey(key) && isSafeSpotlightVariant(variant)) {
      sanitized[key] = variant
      count += 1
    }
  }
  return sanitized
}

/** The variant last chosen (or inferred) for this repo in this task; null when there is none. */
export function getSpotlightVariantForTaskRepo(
  spotlightVariantByTaskRepo: Readonly<Record<string, string>>,
  envKey: string | null,
  repoId: string
): string | null {
  const key = toSpotlightVariantKey(envKey, repoId)
  if (key === null || !Object.hasOwn(spotlightVariantByTaskRepo, key)) {
    return null
  }
  const variant = spotlightVariantByTaskRepo[key]
  return isSafeSpotlightVariant(variant) ? variant : null
}

export function createUiSpotlightVariantActions(
  set: UISliceSet,
  _get: UISliceGet
): Partial<UISlice> {
  return {
    spotlightVariantByTaskRepo: {},
    setSpotlightVariantForTaskRepo: (envKey, repoId, variant) =>
      set((s) => {
        const key = toSpotlightVariantKey(envKey, repoId)
        if (key === null || !isSafeSpotlightVariant(variant)) {
          return s
        }
        const current = s.spotlightVariantByTaskRepo
        if (Object.hasOwn(current, key) && current[key] === variant) {
          return s
        }
        const next = { ...current }
        // Re-added last, so the order runs from the oldest choice to the newest.
        delete next[key]
        // Why evict: every task leaves an entry, and hydration keeps only the first entries up to the cap.
        const keys = Object.keys(next)
        for (const stale of keys.slice(0, Math.max(0, keys.length - MAX_TASK_KEYED_ENTRIES + 1))) {
          delete next[stale]
        }
        next[key] = variant
        window.api.ui.set({ spotlightVariantByTaskRepo: next }).catch(console.error)
        return { spotlightVariantByTaskRepo: next }
      })
  }
}
