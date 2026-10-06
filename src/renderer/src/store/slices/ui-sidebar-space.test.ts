import { afterEach, describe, expect, it, vi } from 'vitest'
import { createUIStore, makePersistedUI } from './ui-slice-test-harness'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('createUISlice active sidebar space', () => {
  it('defaults to All', () => {
    expect(createUIStore().getState().activeSidebarSpaceGroupId).toBeNull()
  })

  it('persists a space change once and skips an unchanged one', () => {
    const setMock = vi.fn(() => Promise.resolve())
    vi.stubGlobal('window', { api: { ui: { set: setMock } } })
    const store = createUIStore()

    store.getState().setActiveSidebarSpaceGroupId('group-1')
    store.getState().setActiveSidebarSpaceGroupId('group-1')

    expect(store.getState().activeSidebarSpaceGroupId).toBe('group-1')
    expect(setMock).toHaveBeenCalledTimes(1)
    expect(setMock).toHaveBeenCalledWith({ activeSidebarSpaceGroupId: 'group-1' })
  })

  it('persists a switch back to All as an explicit null', () => {
    const setMock = vi.fn(() => Promise.resolve())
    vi.stubGlobal('window', { api: { ui: { set: setMock } } })
    const store = createUIStore()

    store.getState().setActiveSidebarSpaceGroupId('group-1')
    store.getState().setActiveSidebarSpaceGroupId(null)

    expect(store.getState().activeSidebarSpaceGroupId).toBeNull()
    expect(setMock).toHaveBeenLastCalledWith({ activeSidebarSpaceGroupId: null })
  })

  it('hydrates the persisted space and falls back to All when it is absent or malformed', () => {
    const store = createUIStore()

    store.getState().hydratePersistedUI(makePersistedUI({ activeSidebarSpaceGroupId: 'group-1' }))
    expect(store.getState().activeSidebarSpaceGroupId).toBe('group-1')

    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: simulates a hand-edited ui.json; hydration must tolerate a non-string at runtime.
    const malformed = makePersistedUI({ activeSidebarSpaceGroupId: 42 as never })
    store.getState().hydratePersistedUI(malformed)
    expect(store.getState().activeSidebarSpaceGroupId).toBeNull()

    store.getState().hydratePersistedUI(makePersistedUI({ activeSidebarSpaceGroupId: 'group-2' }))
    store.getState().hydratePersistedUI(makePersistedUI({ activeSidebarSpaceGroupId: undefined }))
    expect(store.getState().activeSidebarSpaceGroupId).toBeNull()
  })
})
