import { describe, expect, it, vi } from 'vitest'
import { RuntimeTerminalViewSubscribers } from './runtime-terminal-view-subscribers'

const PTY_ID = 'repo-1::/tmp/wt@@1a2b3c4d'

function createSubscribers(opts: { candidate: boolean; attachResult?: boolean }) {
  const state = { candidate: opts.candidate, attachResult: opts.attachResult ?? true }
  const attachCalls: string[] = []
  const notifyPresenceChanged = vi.fn<(ptyId: string) => void>()
  const subscribers = new RuntimeTerminalViewSubscribers({
    notifyPresenceChanged,
    hasMobileSubscribers: () => false,
    isUnattachedLocalCandidate: () => state.candidate,
    attachProvider: async (ptyId) => {
      attachCalls.push(ptyId)
      return state.attachResult
    }
  })
  return { subscribers, state, attachCalls, notifyPresenceChanged }
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

describe('RuntimeTerminalViewSubscribers output observers', () => {
  it('attaches a never-attached local session without becoming a view', () => {
    const { subscribers, attachCalls, notifyPresenceChanged } = createSubscribers({
      candidate: true
    })

    subscribers.registerObserver(PTY_ID)
    subscribers.registerObserver(PTY_ID)

    expect(attachCalls).toEqual([PTY_ID])
    expect(subscribers.hasRemote(PTY_ID)).toBe(false)
    expect(subscribers.hasRaw(PTY_ID)).toBe(false)
    expect(notifyPresenceChanged).not.toHaveBeenCalled()
  })

  it('never attaches a session this app already spawned', () => {
    const { subscribers, attachCalls } = createSubscribers({ candidate: true })
    subscribers.markSpawnPublished(PTY_ID)

    subscribers.registerObserver(PTY_ID)
    subscribers.reconcileProviderAttach(PTY_ID)

    expect(attachCalls).toEqual([])
  })

  it('attaches on inventory reconcile once the session becomes known', () => {
    const { subscribers, state, attachCalls } = createSubscribers({ candidate: false })
    subscribers.registerObserver(PTY_ID)
    expect(attachCalls).toEqual([])

    state.candidate = true
    subscribers.reconcileProviderAttach(PTY_ID)

    expect(attachCalls).toEqual([PTY_ID])
  })

  it('does not attach on reconcile after the observer released', () => {
    const { subscribers, state, attachCalls } = createSubscribers({ candidate: false })
    const release = subscribers.registerObserver(PTY_ID)

    release()
    release()
    state.candidate = true
    subscribers.reconcileProviderAttach(PTY_ID)

    expect(attachCalls).toEqual([])
  })

  it('retries a refused attach from inventory reconcile while an observer remains', async () => {
    const { subscribers, state, attachCalls } = createSubscribers({
      candidate: true,
      attachResult: false
    })
    subscribers.registerObserver(PTY_ID)
    expect(attachCalls).toEqual([PTY_ID])
    await settle()

    state.attachResult = true
    subscribers.reconcileProviderAttach(PTY_ID)
    await settle()

    expect(attachCalls).toEqual([PTY_ID, PTY_ID])
    expect(subscribers.hasPendingProviderAttach(PTY_ID)).toBe(true)
  })

  it('drops observers when the PTY exits', () => {
    const { subscribers, state, attachCalls } = createSubscribers({ candidate: false })
    subscribers.registerObserver(PTY_ID)

    subscribers.clearSubscribers(PTY_ID)
    state.candidate = true
    subscribers.reconcileProviderAttach(PTY_ID)

    expect(attachCalls).toEqual([])
  })
})
