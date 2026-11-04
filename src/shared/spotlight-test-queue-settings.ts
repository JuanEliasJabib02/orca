export const DEFAULT_SPOTLIGHT_MAX_CONCURRENT_TESTS = 2
export const MIN_SPOTLIGHT_MAX_CONCURRENT_TESTS = 1
export const MAX_SPOTLIGHT_MAX_CONCURRENT_TESTS = 4
export const DEFAULT_SPOTLIGHT_AUTO_RESUME_AFTER_USAGE_LIMIT = false

export type SpotlightTestQueueSettings = {
  /** Why: many Playwright/Maestro runs at once freeze the machine; absent means 2, range 1–4. */
  spotlightMaxConcurrentTests?: number
  /** Why: resume a task cut by its usage limit on any account with limit; absent means off. */
  spotlightAutoResumeAfterUsageLimit?: boolean
}

/** Unset or invalid values fall back to the default; anything else is clamped to 1–4. */
export function normalizeSpotlightMaxConcurrentTests(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_SPOTLIGHT_MAX_CONCURRENT_TESTS
  }
  return Math.min(
    MAX_SPOTLIGHT_MAX_CONCURRENT_TESTS,
    Math.max(MIN_SPOTLIGHT_MAX_CONCURRENT_TESTS, Math.trunc(value))
  )
}
