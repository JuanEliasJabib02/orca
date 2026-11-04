import { useEffect, useState } from 'react'
import type { SpotlightResumeAccountPick } from '../../../../../shared/spotlight-agent-turn'

/** Each pick refreshes every account's usage in main, so the popover asks at most once a minute. */
const REPICK_FLOOR_MS = 60_000
/** Usage lags a reset by a moment; the auto-resume retry waits the same margin. */
const RESET_MARGIN_MS = 60_000

/** When to ask again while no account has limit: after the first reset, or in a minute. */
function repickDelayMs(returnsAt: number | null): number {
  if (returnsAt === null) {
    return REPICK_FLOOR_MS
  }
  return Math.max(REPICK_FLOOR_MS, returnsAt + RESET_MARGIN_MS - Date.now())
}

/**
 * The account Continuar would resume a paused task with, asked while the popover shows paused
 * rows: again whenever they change, and until an account has limit again. Null until the first
 * answer, or when the pick failed.
 */
export function useResumeAccountPick(
  pausedPaneKeys: readonly string[]
): SpotlightResumeAccountPick | null {
  const [pick, setPick] = useState<SpotlightResumeAccountPick | null>(null)
  const pausedSignature = pausedPaneKeys.join('\n')

  useEffect(() => {
    if (pausedSignature === '') {
      return
    }
    let cancelled = false
    let repickTimer: ReturnType<typeof setTimeout> | null = null

    const run = async (): Promise<void> => {
      let next: SpotlightResumeAccountPick | null = null
      try {
        next = await window.api.spotlight.pickResumeAccount()
      } catch (err) {
        console.error('Failed to pick the account to resume with:', err)
      }
      if (cancelled) {
        return
      }
      setPick(next)
      if (next?.kind === 'none') {
        repickTimer = setTimeout(() => void run(), repickDelayMs(next.returnsAt))
      }
    }

    void run()
    return () => {
      cancelled = true
      if (repickTimer !== null) {
        clearTimeout(repickTimer)
      }
    }
  }, [pausedSignature])

  return pick
}
