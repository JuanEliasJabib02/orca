import { beforeEach, describe, expect, it, vi } from 'vitest'
import { launchPrimaryWorktree, watchPrimaryFailureForCompanions } from './primary-worktree-launch'

type PendingEntry = { status: 'creating' | 'error' }
type FakeState = { pendingWorktreeCreations: Record<string, PendingEntry> }

const store = vi.hoisted(() => {
  let state: FakeState = { pendingWorktreeCreations: {} }
  const listeners = new Set<(next: FakeState) => void>()
  return {
    getState: () => state,
    setState: (next: FakeState) => {
      state = next
      for (const listener of listeners) {
        listener(state)
      }
    },
    subscribe: (listener: (next: FakeState) => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    listenerCount: () => listeners.size
  }
})
const mocks = vi.hoisted(() => ({
  runBackgroundWorktreeCreation: vi.fn(),
  toastError: vi.fn()
}))

vi.mock('@/store', () => ({ useAppStore: store }))
vi.mock('sonner', () => ({ toast: { error: mocks.toastError } }))
vi.mock('@/lib/worktree-creation-flow', () => ({
  runBackgroundWorktreeCreation: mocks.runBackgroundWorktreeCreation
}))

const COMPANIONS = [
  { repoName: 'backend', branch: 'AX-3448' },
  { repoName: 'admin-action', branch: 'AX-3448' }
]
// oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the launcher only forwards the request to the mocked background create.
const REQUEST = { repoId: 'experience' } as Parameters<typeof launchPrimaryWorktree>[0]['request']

function setPending(status: PendingEntry['status'] | null): void {
  store.setState({ pendingWorktreeCreations: status ? { 'creation-1': { status } } : {} })
}

beforeEach(() => {
  vi.clearAllMocks()
  setPending(null)
  mocks.runBackgroundWorktreeCreation.mockImplementation(() => {
    setPending('creating')
    return 'creation-1'
  })
})

describe('launchPrimaryWorktree', () => {
  it('starts the primary, clears the draft and closes the composer', () => {
    const clearDraft = vi.fn()
    const afterLaunch = vi.fn()

    launchPrimaryWorktree({
      request: REQUEST,
      createdCompanions: [],
      isCancelled: () => false,
      clearDraft,
      afterLaunch
    })

    expect(mocks.runBackgroundWorktreeCreation).toHaveBeenCalledWith(REQUEST)
    expect(clearDraft).toHaveBeenCalledTimes(1)
    expect(afterLaunch).toHaveBeenCalledTimes(1)
    expect(store.listenerCount()).toBe(0)
  })

  it('drops the primary on a dismissal when no companion was created', () => {
    const clearDraft = vi.fn()
    const afterLaunch = vi.fn()

    launchPrimaryWorktree({
      request: REQUEST,
      createdCompanions: [],
      isCancelled: () => true,
      clearDraft,
      afterLaunch
    })

    expect(mocks.runBackgroundWorktreeCreation).not.toHaveBeenCalled()
    expect(clearDraft).not.toHaveBeenCalled()
    expect(afterLaunch).not.toHaveBeenCalled()
  })

  it('still creates the primary after a late dismissal once companions exist', () => {
    const clearDraft = vi.fn()
    const afterLaunch = vi.fn()

    launchPrimaryWorktree({
      request: REQUEST,
      createdCompanions: COMPANIONS,
      isCancelled: () => true,
      clearDraft,
      afterLaunch
    })

    expect(mocks.runBackgroundWorktreeCreation).toHaveBeenCalledWith(REQUEST)
    expect(clearDraft).toHaveBeenCalledTimes(1)
    // The dismissal already closed the dialog; closing again could hit another modal.
    expect(afterLaunch).not.toHaveBeenCalled()
  })
})

describe('watchPrimaryFailureForCompanions', () => {
  it('names the companions left behind once, when the primary fails', () => {
    setPending('creating')
    watchPrimaryFailureForCompanions('creation-1', COMPANIONS)

    setPending('error')
    setPending('error')

    expect(mocks.toastError).toHaveBeenCalledTimes(1)
    expect(mocks.toastError).toHaveBeenCalledWith(
      'The main worktree failed after its companions were created',
      {
        description:
          'These companion worktrees still exist: backend (AX-3448), admin-action (AX-3448). Remove them if you no longer need them.'
      }
    )
    expect(store.listenerCount()).toBe(0)
  })

  it('stays quiet and stops watching when the primary is created or dismissed', () => {
    setPending('creating')
    watchPrimaryFailureForCompanions('creation-1', COMPANIONS)

    setPending(null)
    setPending('error')

    expect(mocks.toastError).not.toHaveBeenCalled()
    expect(store.listenerCount()).toBe(0)
  })

  it('watches nothing without companions', () => {
    setPending('creating')
    watchPrimaryFailureForCompanions('creation-1', [])

    setPending('error')

    expect(mocks.toastError).not.toHaveBeenCalled()
    expect(store.listenerCount()).toBe(0)
  })

  it('reports through the launcher when the background create errors later', () => {
    launchPrimaryWorktree({
      request: REQUEST,
      createdCompanions: COMPANIONS,
      isCancelled: () => false
    })

    setPending('error')

    expect(mocks.toastError).toHaveBeenCalledTimes(1)
  })
})
