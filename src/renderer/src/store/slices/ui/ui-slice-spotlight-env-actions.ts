import {
  DEFAULT_SPOTLIGHT_SERVER_ENV,
  isSpotlightServerEnv,
  type SpotlightServerEnv
} from '../../../../../shared/spotlight-server-types'
import type { UISlice, UISliceGet, UISliceSet } from './ui-slice-contract'
import { isUsableTaskKey, MAX_TASK_KEYED_ENTRIES } from './ui-slice-task-key-record'

/** Keeps known environments under usable task keys; ui.json is hand-editable and may come from another build. */
export function sanitizeSpotlightEnvByTaskKey(value: unknown): Record<string, SpotlightServerEnv> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }
  const sanitized: Record<string, SpotlightServerEnv> = {}
  let count = 0
  for (const [taskKey, env] of Object.entries(value)) {
    if (count >= MAX_TASK_KEYED_ENTRIES) {
      break
    }
    if (isUsableTaskKey(taskKey) && isSpotlightServerEnv(env)) {
      sanitized[taskKey] = env
      count += 1
    }
  }
  return sanitized
}

/** The environment a task's Spotlight servers run in; `local` when none was chosen. */
export function getSpotlightEnvForTask(
  spotlightEnvByTaskKey: Readonly<Record<string, SpotlightServerEnv>>,
  taskKey: string | null
): SpotlightServerEnv {
  if (taskKey === null || !Object.hasOwn(spotlightEnvByTaskKey, taskKey)) {
    return DEFAULT_SPOTLIGHT_SERVER_ENV
  }
  const env = spotlightEnvByTaskKey[taskKey]
  return isSpotlightServerEnv(env) ? env : DEFAULT_SPOTLIGHT_SERVER_ENV
}

export function createUiSpotlightEnvActions(set: UISliceSet, _get: UISliceGet): Partial<UISlice> {
  return {
    spotlightEnvByTaskKey: {},
    setSpotlightEnvForTask: (taskKey, env) =>
      set((s) => {
        if (!isUsableTaskKey(taskKey) || !isSpotlightServerEnv(env)) {
          return s
        }
        if (getSpotlightEnvForTask(s.spotlightEnvByTaskKey, taskKey) === env) {
          return s
        }
        // Why: hydration drops entries past the cap, so an environment added beyond it would vanish on restart.
        if (
          env !== DEFAULT_SPOTLIGHT_SERVER_ENV &&
          !Object.hasOwn(s.spotlightEnvByTaskKey, taskKey) &&
          Object.keys(s.spotlightEnvByTaskKey).length >= MAX_TASK_KEYED_ENTRIES
        ) {
          return s
        }
        const next = { ...s.spotlightEnvByTaskKey }
        // Why: the default is the absence of an entry, so the map only holds deviations.
        if (env === DEFAULT_SPOTLIGHT_SERVER_ENV) {
          delete next[taskKey]
        } else {
          next[taskKey] = env
        }
        window.api.ui.set({ spotlightEnvByTaskKey: next }).catch(console.error)
        return { spotlightEnvByTaskKey: next }
      })
  }
}
