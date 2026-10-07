// Spotlight turned off while its queued server line was on its way into a shell, which runs it
// anyway. Main (PTYs it mirrors) and the renderer (PTYs it never saw) interrupt it by this one rule.

export const SPOTLIGHT_STRAY_STARTUP_WATCH_MS = 30_000
export const SPOTLIGHT_STRAY_STARTUP_POLL_MS = 500
// Servers persist; rc-file hooks (e.g. `conda shell.zsh hook`) are done well before this.
export const SPOTLIGHT_STRAY_CHILD_PERSIST_MS = 2500
// The interrupt, plus one follow-up for a server that outlives it.
export const SPOTLIGHT_STRAY_MAX_INTERRUPTS = 2

export type StraySpotlightStartupState = {
  /** When the current unbroken run of "has a child" readings began. */
  runningSince: number | null
  interrupts: number
}

export type StraySpotlightStartupStep = {
  next: StraySpotlightStartupState
  action: 'wait' | 'interrupt' | 'done'
}

export const STRAY_SPOTLIGHT_STARTUP_START: StraySpotlightStartupState = {
  runningSince: null,
  interrupts: 0
}

/** One reading of whether the terminal runs a child, taken at `now`. */
export function stepStraySpotlightStartup(
  state: StraySpotlightStartupState,
  running: boolean,
  now: number
): StraySpotlightStartupStep {
  if (!running) {
    // After a Ctrl-C the child is gone: done. Before one, it was a short-lived startup process.
    return state.interrupts > 0
      ? { next: state, action: 'done' }
      : { next: STRAY_SPOTLIGHT_STARTUP_START, action: 'wait' }
  }
  const runningSince = state.runningSince ?? now
  if (now - runningSince < SPOTLIGHT_STRAY_CHILD_PERSIST_MS) {
    return { next: { ...state, runningSince }, action: 'wait' }
  }
  if (state.interrupts >= SPOTLIGHT_STRAY_MAX_INTERRUPTS) {
    return { next: state, action: 'done' }
  }
  // A follow-up needs the child to persist past this Ctrl-C as well.
  return { next: { runningSince: now, interrupts: state.interrupts + 1 }, action: 'interrupt' }
}

/** Polls the terminal by the rule above until it is done, `shouldStop` holds (Spotlight back on,
 *  the tab gone), or the watch window ends. `interrupt` returns false when the write failed. */
export function watchStraySpotlightStartup(args: {
  isRunning: () => Promise<boolean>
  interrupt: () => boolean
  shouldStop: () => boolean
}): void {
  let state = STRAY_SPOTLIGHT_STARTUP_START
  let done = false
  let pollTimer: ReturnType<typeof setTimeout> | null = null
  const finish = (): void => {
    done = true
    clearTimeout(deadline)
    if (pollTimer !== null) {
      clearTimeout(pollTimer)
    }
  }
  const deadline = setTimeout(finish, SPOTLIGHT_STRAY_STARTUP_WATCH_MS)
  const poll = async (): Promise<void> => {
    let running = false
    try {
      running = await args.isRunning()
    } catch {
      running = false
    }
    if (done) {
      return
    }
    if (args.shouldStop()) {
      finish()
      return
    }
    const step = stepStraySpotlightStartup(state, running, Date.now())
    state = step.next
    const spent =
      step.action === 'interrupt' &&
      (!args.interrupt() || state.interrupts >= SPOTLIGHT_STRAY_MAX_INTERRUPTS)
    if (step.action === 'done' || spent) {
      finish()
      return
    }
    pollTimer = setTimeout(() => void poll(), SPOTLIGHT_STRAY_STARTUP_POLL_MS)
  }
  pollTimer = setTimeout(() => void poll(), SPOTLIGHT_STRAY_STARTUP_POLL_MS)
}
