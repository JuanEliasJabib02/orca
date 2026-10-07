import { useAppStore } from '@/store'
import { getSpotlightEnvForTask } from '@/store/slices/ui/ui-slice-spotlight-env-actions'
import { applySpotlightEnvChange } from '@/lib/spotlight-server-autostart'
import type { SpotlightServerEnv } from '../../../shared/spotlight-server-types'

/** Saves the environment under `envKey`, then restarts the held servers whose command changes. */
export function switchSpotlightEnv(envKey: string, env: SpotlightServerEnv): void {
  const state = useAppStore.getState()
  if (getSpotlightEnvForTask(state.spotlightEnvByTaskKey, envKey) === env) {
    return
  }
  state.setSpotlightEnvForTask(envKey, env)
  void applySpotlightEnvChange(envKey)
}
