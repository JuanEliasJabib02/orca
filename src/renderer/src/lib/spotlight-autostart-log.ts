// The renderer's half of the Spotlight autostart notes: each decision it takes becomes one line in
// the repo's .orca/spotlight.log (main words it). Main notes the starts it decides itself.
import type { SpotlightServerStartResult } from '../../../shared/spotlight'
import type { SpotlightAutostartNote } from '../../../shared/spotlight-autostart-note'
import type { SpotlightActivationCommandPlan } from '@/lib/spotlight-server-command-plan'

/** Fire-and-forget; never throws, so a note can't break the autostart it describes. */
export function logSpotlightAutostart(repoId: string, note: SpotlightAutostartNote): void {
  try {
    // Optional-chained: a renderer/preload version skew must never break starting the server.
    void Promise.resolve(window.api.spotlight.noteServerAutostart?.({ repoId, note })).catch(
      (error: unknown) => console.warn('[spotlight] Could not log the autostart decision:', error)
    )
  } catch (error) {
    console.warn('[spotlight] Could not log the autostart decision:', error)
  }
}

/** Why an activation runs no command: none for the environment, a variant to pick, or a failure. */
export function logSpotlightActivationWithoutCommand(
  repoId: string,
  plan: Exclude<SpotlightActivationCommandPlan, { kind: 'command' }> | null
): void {
  if (plan === null) {
    logSpotlightAutostart(repoId, { kind: 'plan-failed' })
  } else if (plan.kind === 'ask-variant') {
    logSpotlightAutostart(repoId, { kind: 'needs-variant', asked: true })
  } else if (plan.env === null) {
    logSpotlightAutostart(repoId, { kind: 'needs-variant', asked: false })
  } else {
    logSpotlightAutostart(repoId, { kind: 'no-command', env: plan.env })
  }
}

/** A start request that failed after its retries. Main notes every answer it decided itself, a gone
 *  PTY included (the caller respawns it), so only failures it never saw through are noted here. */
export function logFailedSpotlightStart(
  repoId: string,
  result: SpotlightServerStartResult | null
): void {
  if (result === null) {
    logSpotlightAutostart(repoId, { kind: 'start-failed', reason: 'error' })
  } else if (!result.ok && result.reason !== 'terminal-gone') {
    logSpotlightAutostart(repoId, { kind: 'start-failed', reason: result.reason })
  }
}
