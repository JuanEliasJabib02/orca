import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  SPOTLIGHT_STRAY_CHILD_PERSIST_MS,
  SPOTLIGHT_STRAY_STARTUP_POLL_MS,
  SPOTLIGHT_STRAY_STARTUP_WATCH_MS,
  STRAY_SPOTLIGHT_STARTUP_START,
  stepStraySpotlightStartup,
  watchStraySpotlightStartup,
  type StraySpotlightStartupState
} from './spotlight-stray-startup'

/** Feeds readings 500 ms apart and returns the actions taken. */
function run(readings: boolean[], start = STRAY_SPOTLIGHT_STARTUP_START): string[] {
  let state: StraySpotlightStartupState = start
  return readings.map((running, index) => {
    const step = stepStraySpotlightStartup(state, running, index * SPOTLIGHT_STRAY_STARTUP_POLL_MS)
    state = step.next
    return step.action
  })
}

describe('stepStraySpotlightStartup', () => {
  it('leaves a startup-file child that exits before it persists', () => {
    // A 2 s rc hook, then the idle prompt.
    expect(run([true, true, true, true, false, false])).not.toContain('interrupt')
  })

  it('interrupts a child once it persists, then is done when it is gone', () => {
    expect(run([true, true, true, true, true, true, false])).toEqual([
      'wait',
      'wait',
      'wait',
      'wait',
      'wait',
      'interrupt',
      'done'
    ])
  })

  it('restarts the persistence window when the child goes away', () => {
    expect(run([true, true, true, true, false, true, true, true, true, true])).not.toContain(
      'interrupt'
    )
  })

  it('sends one follow-up for a child that outlives the interrupt, and no more', () => {
    const actions = run(Array.from({ length: 30 }, () => true))

    expect(actions.filter((action) => action === 'interrupt')).toHaveLength(2)
    expect(actions.at(-1)).toBe('done')
  })
})

describe('watchStraySpotlightStartup', () => {
  let running = true
  const interrupt = vi.fn((): boolean => {
    running = false
    return true
  })
  const isRunning = vi.fn(async (): Promise<boolean> => running)

  beforeEach(() => {
    vi.useFakeTimers()
    running = true
    interrupt.mockClear()
    isRunning.mockReset()
    isRunning.mockImplementation(async () => running)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('interrupts a persistent child once and stops on success', async () => {
    watchStraySpotlightStartup({ isRunning, interrupt, shouldStop: () => false })

    // First reading at 500 ms, the interrupt 2.5 s later.
    await vi.advanceTimersByTimeAsync(SPOTLIGHT_STRAY_CHILD_PERSIST_MS + 700)
    expect(interrupt).toHaveBeenCalledTimes(1)
    const readings = isRunning.mock.calls.length
    await vi.advanceTimersByTimeAsync(SPOTLIGHT_STRAY_STARTUP_WATCH_MS)

    expect(interrupt).toHaveBeenCalledTimes(1)
    expect(isRunning.mock.calls.length).toBe(readings + 1)
  })

  it("counts the caller's Ctrl-C: a child that outlives it gets one follow-up at most", async () => {
    interrupt.mockImplementationOnce(() => true)
    watchStraySpotlightStartup({
      isRunning,
      interrupt,
      shouldStop: () => false,
      alreadyInterrupted: true
    })

    await vi.advanceTimersByTimeAsync(SPOTLIGHT_STRAY_CHILD_PERSIST_MS)
    expect(interrupt).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(SPOTLIGHT_STRAY_STARTUP_WATCH_MS)

    expect(interrupt).toHaveBeenCalledTimes(1)
  })

  it("keeps waiting after the caller's Ctrl-C and gives a line that runs later one follow-up", async () => {
    running = false
    watchStraySpotlightStartup({
      isRunning,
      interrupt,
      shouldStop: () => false,
      alreadyInterrupted: true
    })

    await vi.advanceTimersByTimeAsync(SPOTLIGHT_STRAY_CHILD_PERSIST_MS * 2)
    expect(interrupt).not.toHaveBeenCalled()
    running = true
    await vi.advanceTimersByTimeAsync(SPOTLIGHT_STRAY_STARTUP_WATCH_MS)

    expect(interrupt).toHaveBeenCalledTimes(1)
  })

  it("never interrupts when nothing runs after the caller's Ctrl-C", async () => {
    running = false
    watchStraySpotlightStartup({
      isRunning,
      interrupt,
      shouldStop: () => false,
      alreadyInterrupted: true
    })

    await vi.advanceTimersByTimeAsync(SPOTLIGHT_STRAY_STARTUP_WATCH_MS)

    expect(interrupt).not.toHaveBeenCalled()
  })

  it('stops without interrupting when told to', async () => {
    watchStraySpotlightStartup({ isRunning, interrupt, shouldStop: () => true })

    await vi.advanceTimersByTimeAsync(SPOTLIGHT_STRAY_STARTUP_WATCH_MS)

    expect(interrupt).not.toHaveBeenCalled()
    expect(isRunning).toHaveBeenCalledTimes(1)
  })

  it('gives up after the watch window', async () => {
    isRunning.mockResolvedValue(false)
    watchStraySpotlightStartup({ isRunning, interrupt, shouldStop: () => false })

    await vi.advanceTimersByTimeAsync(SPOTLIGHT_STRAY_STARTUP_WATCH_MS)
    const readings = isRunning.mock.calls.length
    await vi.advanceTimersByTimeAsync(SPOTLIGHT_STRAY_STARTUP_WATCH_MS)

    expect(isRunning.mock.calls.length).toBe(readings)
    expect(interrupt).not.toHaveBeenCalled()
  })
})
