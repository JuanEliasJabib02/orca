// Test queue auto-resume: with its switch on, a pane cut by its usage limit is resumed alone on an
// account with limit left, at most 3 times in a row, with a notice each time.
import { useEffect } from 'react'
import { useAppStore } from '@/store'
import type { SpotlightAgentPausedRow } from '../../../shared/spotlight-agent-turn'
import { DEFAULT_SPOTLIGHT_AUTO_RESUME_AFTER_USAGE_LIMIT } from '../../../shared/spotlight-test-queue-settings'

/** Main refuses automatic resumes past this many in a row too (`spotlight-agent-turn-pause.ts`). */
const MAX_AUTO_RESUMES_IN_A_ROW = 3
/** A pane no account could take is tried again this long after the first account's reset. */
const RETRY_AFTER_RESET_MS = 60_000
/** setTimeout fires at once past this delay. */
const MAX_TIMER_DELAY_MS = 2_147_483_647

/** One pause of one pane: the pane's next pause is a new chance. */
function pauseKey(row: SpotlightAgentPausedRow): string {
  return `${row.paneKey}:${row.pausedAt}`
}

function canAutoResume(row: SpotlightAgentPausedRow): boolean {
  return (
    row.reason === 'limit' &&
    !row.resuming &&
    (row.autoResumes ?? 0) < MAX_AUTO_RESUMES_IN_A_ROW
  )
}

function notifyAutoResumed(row: SpotlightAgentPausedRow, accountLabel: string): void {
  void window.api.notifications
    .dispatch({
      source: 'test-queue-auto-resume',
      worktreeLabel: row.taskKey,
      accountLabel,
      // Why: unkeyed notices share one cooldown per workspace; each resume is its own news.
      attentionKey: `test-queue-auto-resume:${pauseKey(row)}`
    })
    .catch((error: unknown) => console.warn('[test-queue] auto-resume notice failed:', error))
}

/** Resumes each pause it has not tried yet, one at a time; returns the cleanup. */
function watchAutoResume(): () => void {
  // Why per pause: a settled resume leaves its row `Pausado` until the agent asks for its turn.
  const tried = new Set<string>()
  const retries = new Map<string, ReturnType<typeof setTimeout>>()
  let running = false
  let stopped = false

  const forget = (key: string): void => {
    tried.delete(key)
    clearTimeout(retries.get(key))
    retries.delete(key)
  }

  const retryAfterReset = (key: string, returnsAt: number): void => {
    // Why the floor: a reset already past still reads as spent until the usage refresh catches up.
    const delay = Math.min(
      Math.max(returnsAt + RETRY_AFTER_RESET_MS - Date.now(), RETRY_AFTER_RESET_MS),
      MAX_TIMER_DELAY_MS
    )
    const timer = setTimeout(() => {
      forget(key)
      scan()
    }, delay)
    retries.set(key, timer)
  }

  const resume = async (row: SpotlightAgentPausedRow): Promise<void> => {
    const key = pauseKey(row)
    tried.add(key)
    running = true
    try {
      const { continueTestTask } = useAppStore.getState()
      const { delivered, pick } = await continueTestTask(row.paneKey, { auto: true })
      if (delivered && pick?.kind === 'account') {
        notifyAutoResumed(row, pick.label)
      } else if (pick?.kind === 'none' && pick.returnsAt !== null && !stopped) {
        retryAfterReset(key, pick.returnsAt)
      }
    } catch (error) {
      console.warn('[test-queue] auto-resume failed:', error)
    } finally {
      running = false
    }
    scan()
  }

  // Why one at a time: each resume can switch Orca's active account before restarting its pane.
  function scan(): void {
    if (stopped || running) {
      return
    }
    const state = useAppStore.getState()
    const rows = state.spotlightTurns.paused ?? []
    const live = new Set(rows.map(pauseKey))
    for (const key of tried) {
      if (!live.has(key)) {
        forget(key)
      }
    }
    const enabled =
      state.settings?.spotlightAutoResumeAfterUsageLimit ??
      DEFAULT_SPOTLIGHT_AUTO_RESUME_AFTER_USAGE_LIMIT
    const next = enabled
      ? rows.find((row) => canAutoResume(row) && !tried.has(pauseKey(row)))
      : undefined
    if (next) {
      void resume(next)
    }
  }

  const unsubscribe = useAppStore.subscribe((state, previous) => {
    if (state.spotlightTurns !== previous.spotlightTurns || state.settings !== previous.settings) {
      scan()
    }
  })
  scan()
  return () => {
    stopped = true
    unsubscribe()
    for (const timer of retries.values()) {
      clearTimeout(timer)
    }
    retries.clear()
  }
}

/** Mounted once in the app shell, so it runs whether or not the footer popover is open. */
export function useTestQueueAutoResume(): void {
  useEffect(() => watchAutoResume(), [])
}
