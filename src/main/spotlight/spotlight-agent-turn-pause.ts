// How a turn ends when its agent stops: a failure pauses it (out of usage limit or another error),
// and Continuar resumes it inside a window where the restart's own turn ends don't count.
import type { AgentStatusIpcPayload } from '../../shared/agent-status/contracts/agent-status-ipc-payload'
import { errorMessage } from '../../shared/error-message'
import type { SpotlightTurn, SpotlightTurnQueue } from './spotlight-agent-turn-queue'

/** How a pane's agent last ended a turn: Claude's StopFailure, a session start, or anything else. */
export type SpotlightTurnEnd = 'failure' | 'boundary' | 'normal'

export type SpotlightTurnEndRow = Pick<
  AgentStatusIpcPayload,
  'state' | 'receivedAt' | 'mainAgent' | 'sessionBoundary'
>

/** Agent statuses as the hook server publishes them. */
export type SpotlightAgentStatusEntry = {
  paneKey: string
  state: string
  receivedAt: number
  observedInCurrentRuntime: boolean
}

/** Continuar gives up on a resume nobody settled after this long. */
export const RESUME_WINDOW_MS = 3 * 60_000
/** Automatic resumes of one pane before it waits for a click. */
export const MAX_AUTO_RESUMES_IN_A_ROW = 3

/** Reads the newest finished row of the pane's hook rows. */
export function readTurnEndFromRows(rows: readonly SpotlightTurnEndRow[]): SpotlightTurnEnd {
  let newest: SpotlightTurnEndRow | null = null
  for (const row of rows) {
    if (row.state === 'done' && (!newest || row.receivedAt > newest.receivedAt)) {
      newest = row
    }
  }
  if (newest?.mainAgent?.outcome === 'failure') {
    return 'failure'
  }
  return newest?.sessionBoundary === true ? 'boundary' : 'normal'
}

/** What a turn end newer than the pane's last request does to its place. */
function turnEndAction(
  end: SpotlightTurnEnd,
  pane: { paused: boolean; resuming: boolean }
): 'ignore' | 'release' | 'pause' {
  if (end === 'boundary') {
    return 'ignore'
  }
  if (end === 'failure') {
    // Why: the killed agent re-publishes its failure; pausing a paused pane changes nothing.
    return pane.paused ? 'ignore' : 'pause'
  }
  // Why: inside Continuar's window the Esc and the restart end turns on purpose.
  return pane.resuming ? 'ignore' : 'release'
}

/** What the turns lend the pause logic. */
export type SpotlightTurnPauseHost = {
  queue: Pick<SpotlightTurnQueue, 'positionOf' | 'pause'>
  now: () => number
  /** When the pane last asked for its turn; undefined once it left. */
  requestedAt: (paneKey: string) => number | undefined
  /** Gives the pane's turn or place back, as `orca spotlight off` does. */
  release: (paneKey: string) => void
  /** Turns a pause granted, to light. */
  granted: (turns: readonly SpotlightTurn[]) => void
  publish: () => void
  readTurnEnd?: (paneKey: string) => SpotlightTurnEnd
  paneAccountAtLimit?: (paneKey: string) => Promise<boolean>
}

/**
 * Turn ends, pauses and Continuar's bookkeeping per pane: its resuming window, its automatic
 * resumes in a row, the newest turn end already handled, and a pause whose usage read is running.
 */
export class SpotlightTurnPauses {
  private readonly windows = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly autoCounts = new Map<string, number>()
  private readonly handled = new Map<string, number>()
  private readonly pausing = new Set<string>()

  constructor(private readonly host: SpotlightTurnPauseHost) {}

  isResuming(paneKey: string): boolean {
    return this.windows.has(paneKey)
  }

  autoResumes(paneKey: string): number {
    return this.autoCounts.get(paneKey) ?? 0
  }

  /**
   * A `done` newer than the pane's last request (and than any end already handled) ends its
   * turn, pauses it, or is ignored, by how the agent stopped. Resolves once every pause is decided.
   */
  handleStatuses(entries: readonly SpotlightAgentStatusEntry[]): Promise<void> {
    const ends: Promise<void>[] = []
    const ended = new Set<string>()
    for (const entry of entries) {
      const requestedAt = this.host.requestedAt(entry.paneKey)
      if (
        requestedAt === undefined ||
        ended.has(entry.paneKey) ||
        entry.state !== 'done' ||
        !entry.observedInCurrentRuntime ||
        entry.receivedAt <= Math.max(requestedAt, this.handled.get(entry.paneKey) ?? 0)
      ) {
        continue
      }
      ended.add(entry.paneKey)
      ends.push(this.endTurn(entry.paneKey))
    }
    return Promise.all(ends).then(() => undefined)
  }

  /**
   * Opens Continuar's window for a paused pane or a holder: its turn ends and teardown don't
   * count until `resumeSettled` or the window runs out. False when the pane is neither, a window
   * is open, or `auto` and its automatic resumes in a row are used up. Never grants a turn.
   */
  markResuming(paneKey: string, options: { auto: boolean }): boolean {
    const position = this.host.queue.positionOf(paneKey)
    const resumable =
      position?.kind === 'holding' ||
      (position?.kind === 'waiting' && position.paused !== undefined)
    const count = this.autoResumes(paneKey)
    if (
      !resumable ||
      this.windows.has(paneKey) ||
      (options.auto && count >= MAX_AUTO_RESUMES_IN_A_ROW)
    ) {
      return false
    }
    if (options.auto) {
      this.autoCounts.set(paneKey, count + 1)
    }
    const timer = setTimeout(() => {
      if (this.closeWindow(paneKey)) {
        this.host.publish()
      }
    }, RESUME_WINDOW_MS)
    this.windows.set(paneKey, timer)
    this.host.publish()
    return true
  }

  /** Continuar finished; a delivered follow-up spends every turn end up to now. */
  resumeSettled(paneKey: string, result: { delivered: boolean }): void {
    if (!this.closeWindow(paneKey)) {
      return
    }
    if (result.delivered) {
      // Why: the Esc's cancellation and the old session's rows are older than the follow-up.
      this.markHandled(paneKey, this.host.now())
    }
    this.host.publish()
  }

  /** Ends the pane's window; true when one was open. */
  closeWindow(paneKey: string): boolean {
    const timer = this.windows.get(paneKey)
    if (timer === undefined) {
      return false
    }
    clearTimeout(timer)
    this.windows.delete(paneKey)
    return true
  }

  /** The pane left the queue: its window, its automatic count and its handled ends go. */
  forget(paneKey: string): void {
    this.closeWindow(paneKey)
    this.autoCounts.delete(paneKey)
    this.handled.delete(paneKey)
    this.pausing.delete(paneKey)
  }

  private markHandled(paneKey: string, at: number): void {
    this.handled.set(paneKey, Math.max(at, this.handled.get(paneKey) ?? 0))
  }

  private endTurn(paneKey: string): Promise<void> {
    const end = this.host.readTurnEnd?.(paneKey) ?? 'normal'
    const position = this.host.queue.positionOf(paneKey)
    const paused =
      this.pausing.has(paneKey) || (position?.kind === 'waiting' && position.paused !== undefined)
    const action = turnEndAction(end, { paused, resuming: this.isResuming(paneKey) })
    if (action === 'pause') {
      return this.pause(paneKey)
    }
    if (action === 'release') {
      this.host.release(paneKey)
    }
    return Promise.resolve()
  }

  /** One forced usage read decides `limit` or `error`; the pane keeps its place, claims nothing. */
  private async pause(paneKey: string): Promise<void> {
    const askedAt = this.host.requestedAt(paneKey)
    this.pausing.add(paneKey)
    let atLimit = false
    try {
      atLimit = (await this.host.paneAccountAtLimit?.(paneKey)) ?? false
    } catch (error) {
      console.warn('[spotlight] Could not read the usage of a stopped agent:', errorMessage(error))
    }
    this.pausing.delete(paneKey)
    // Why: a pane that asked again or left while its usage was read is past this stop.
    if (this.host.requestedAt(paneKey) !== askedAt) {
      return
    }
    const outcome = this.host.queue.pause(paneKey, { reason: atLimit ? 'limit' : 'error' })
    this.markHandled(paneKey, this.host.now())
    this.host.granted(outcome.granted)
    this.host.publish()
  }
}
