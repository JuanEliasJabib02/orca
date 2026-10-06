import { afterEach, describe, expect, it, vi } from 'vitest'
import { createUIStore, makePersistedUI } from './ui-slice-test-harness'
import { sanitizeComposerCompanionRepoIds } from './ui/ui-slice-composer-companion-actions'

afterEach(() => {
  vi.unstubAllGlobals()
})

function stubUiSet(): ReturnType<typeof vi.fn> {
  const setMock = vi.fn(() => Promise.resolve())
  vi.stubGlobal('window', { api: { ui: { set: setMock } } })
  return setMock
}

describe('composer companion repos memory', () => {
  it('starts empty', () => {
    expect(createUIStore().getState().composerCompanionRepoIdsByRepoId).toEqual({})
  })

  it('remembers companions per primary repo and persists the whole map', () => {
    const setMock = stubUiSet()
    const store = createUIStore()

    store.getState().setComposerCompanionRepoIds('experience', ['backend', 'admin'])
    store.getState().setComposerCompanionRepoIds('reset', ['backend'])

    expect(store.getState().composerCompanionRepoIdsByRepoId).toEqual({
      experience: ['backend', 'admin'],
      reset: ['backend']
    })
    expect(setMock).toHaveBeenLastCalledWith({
      composerCompanionRepoIdsByRepoId: { experience: ['backend', 'admin'], reset: ['backend'] }
    })
  })

  it('skips the write when nothing changed and drops an emptied entry', () => {
    const setMock = stubUiSet()
    const store = createUIStore()

    store.getState().setComposerCompanionRepoIds('experience', ['backend'])
    store.getState().setComposerCompanionRepoIds('experience', ['backend'])
    expect(setMock).toHaveBeenCalledTimes(1)

    store.getState().setComposerCompanionRepoIds('experience', [])
    expect(store.getState().composerCompanionRepoIdsByRepoId).toEqual({})
    expect(setMock).toHaveBeenLastCalledWith({
      composerCompanionRepoIdsByRepoId: {}
    })
  })

  it('never remembers the primary as its own companion', () => {
    stubUiSet()
    const store = createUIStore()
    store.getState().setComposerCompanionRepoIds('experience', ['experience', 'admin', 'admin'])
    expect(store.getState().composerCompanionRepoIdsByRepoId).toEqual({ experience: ['admin'] })
  })

  it('hydrates the persisted map and tolerates a hand-edited one', () => {
    const store = createUIStore()
    store.getState().hydratePersistedUI(
      makePersistedUI({
        composerCompanionRepoIdsByRepoId: { experience: ['backend'] }
      })
    )
    expect(store.getState().composerCompanionRepoIdsByRepoId).toEqual({ experience: ['backend'] })

    store.getState().hydratePersistedUI(makePersistedUI({}))
    expect(store.getState().composerCompanionRepoIdsByRepoId).toEqual({})
  })
})

describe('sanitizeComposerCompanionRepoIds', () => {
  it('keeps only string arrays and drops empty entries', () => {
    expect(
      sanitizeComposerCompanionRepoIds({
        experience: ['backend', 7, '', 'backend'],
        reset: 'admin',
        admin: [],
        backend: ['backend']
      })
    ).toEqual({ experience: ['backend'] })
    expect(sanitizeComposerCompanionRepoIds(['backend'])).toEqual({})
    expect(sanitizeComposerCompanionRepoIds(null)).toEqual({})
  })
})
