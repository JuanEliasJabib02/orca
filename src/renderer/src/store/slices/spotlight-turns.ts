import type { StateCreator } from 'zustand'
import type { AppState } from '../types'
import {
  emptySpotlightAgentStatus,
  type SpotlightAgentStatus
} from '../../../../shared/spotlight-agent-turn'

export type SpotlightTurnsSlice = {
  /** Main's test queue (agents' `orca spotlight` turns), for the footer and the task badges. */
  spotlightTurns: SpotlightAgentStatus
  /** An equal board keeps the current one, so the footer and badges skip a no-op push. */
  applySpotlightTurns: (board: SpotlightAgentStatus) => void
  hydrateSpotlightTurns: () => Promise<void>
}

// Why serialize: the board is plain IPC data built by one function in main, so equal boards match.
function spotlightBoardsEqual(a: SpotlightAgentStatus, b: SpotlightAgentStatus): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b)
}

export const createSpotlightTurnsSlice: StateCreator<AppState, [], [], SpotlightTurnsSlice> = (
  set,
  get
) => ({
  spotlightTurns: emptySpotlightAgentStatus(),

  applySpotlightTurns: (board) => {
    if (!spotlightBoardsEqual(get().spotlightTurns, board)) {
      set({ spotlightTurns: board })
    }
  },

  hydrateSpotlightTurns: async () => {
    try {
      get().applySpotlightTurns(await window.api.spotlight.getTurns())
    } catch (err) {
      console.error('Failed to hydrate the test queue:', err)
    }
  }
})

/** Follows main's test queue: every push, plus one read now for the board before the first push. */
export function subscribeSpotlightTurns(store: {
  getState: () => Pick<AppState, 'applySpotlightTurns' | 'hydrateSpotlightTurns'>
}): () => void {
  // Why subscribe first: a push landing during the read is never missed.
  const unsubscribe = window.api.spotlight.onTurnsChanged((board) =>
    store.getState().applySpotlightTurns(board)
  )
  void store.getState().hydrateSpotlightTurns()
  return unsubscribe
}
