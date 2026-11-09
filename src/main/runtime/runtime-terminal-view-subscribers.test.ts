import { describe, expect, it, vi } from 'vitest'
import { RuntimeTerminalViewSubscribers } from './terminal/view/runtime-terminal-view-subscribers'

const PTY_ID = 'repo-1::/tmp/wt@@1a2b3c4d'

// Which sessions attach, retries and spawned-session exclusion belong to MainDaemonAttachments
// (covered by terminal-subscriber-driven-daemon-attach.test.ts); this pins the observer's contract.
describe('RuntimeTerminalViewSubscribers output observers', () => {
  it('drives the daemon attach without becoming a view', () => {
    const ensureProviderAttach = vi.fn<(ptyId: string) => void>()
    const notifyPresenceChanged = vi.fn<(ptyId: string) => void>()
    const subscribers = new RuntimeTerminalViewSubscribers({
      notifyPresenceChanged,
      hasMobileSubscribers: () => false,
      ensureProviderAttach
    })

    subscribers.registerObserver(PTY_ID)

    expect(ensureProviderAttach).toHaveBeenCalledWith(PTY_ID)
    expect(subscribers.hasRemote(PTY_ID)).toBe(false)
    expect(subscribers.hasRaw(PTY_ID)).toBe(false)
    expect(subscribers.hasRemoteAnsweringQueries(PTY_ID)).toBe(false)
    expect(notifyPresenceChanged).not.toHaveBeenCalled()
  })
})
