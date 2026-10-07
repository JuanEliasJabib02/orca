import { afterEach, describe, expect, it, vi } from 'vitest'
import { createUIStore, makePersistedUI } from './ui-slice-test-harness'
import {
  getTaskNote,
  normalizeTaskNote,
  sanitizeTaskNoteByTaskKey
} from './ui/ui-slice-task-note-actions'

afterEach(() => {
  vi.unstubAllGlobals()
})

function stubUiSet(): ReturnType<typeof vi.fn> {
  const setMock = vi.fn(() => Promise.resolve())
  vi.stubGlobal('window', { api: { ui: { set: setMock } } })
  return setMock
}

describe('Task notes', () => {
  it('starts empty', () => {
    expect(createUIStore().getState().taskNoteByTaskKey).toEqual({})
  })

  it('remembers a note per task and persists the whole map', () => {
    const setMock = stubUiSet()
    const store = createUIStore()

    store.getState().setTaskNote('AX-3423', 'POS Action Wear')
    store.getState().setTaskNote('AX-3500', 'Kiosk refund flow')

    expect(store.getState().taskNoteByTaskKey).toEqual({
      'AX-3423': 'POS Action Wear',
      'AX-3500': 'Kiosk refund flow'
    })
    expect(setMock).toHaveBeenLastCalledWith({
      taskNoteByTaskKey: { 'AX-3423': 'POS Action Wear', 'AX-3500': 'Kiosk refund flow' }
    })
  })

  it('replaces an existing note', () => {
    const setMock = stubUiSet()
    const store = createUIStore()

    store.getState().setTaskNote('AX-3423', 'POS Action Wear')
    store.getState().setTaskNote('AX-3423', 'POS Action Wear, refunds')

    expect(store.getState().taskNoteByTaskKey).toEqual({ 'AX-3423': 'POS Action Wear, refunds' })
    expect(setMock).toHaveBeenCalledTimes(2)
  })

  it('stores the trimmed note', () => {
    stubUiSet()
    const store = createUIStore()

    store.getState().setTaskNote('AX-3423', '  POS Action Wear \n')

    expect(store.getState().taskNoteByTaskKey).toEqual({ 'AX-3423': 'POS Action Wear' })
  })

  it('removes the note when an empty or blank one is saved', () => {
    const setMock = stubUiSet()
    const store = createUIStore()

    store.getState().setTaskNote('AX-3423', 'POS Action Wear')
    store.getState().setTaskNote('AX-3500', 'Kiosk refund flow')
    store.getState().setTaskNote('AX-3423', '')
    expect(store.getState().taskNoteByTaskKey).toEqual({ 'AX-3500': 'Kiosk refund flow' })

    store.getState().setTaskNote('AX-3500', '  \n ')
    expect(store.getState().taskNoteByTaskKey).toEqual({})
    expect(setMock).toHaveBeenLastCalledWith({ taskNoteByTaskKey: {} })
  })

  it('caps a note at 500 characters', () => {
    stubUiSet()
    const store = createUIStore()

    store.getState().setTaskNote('AX-3423', 'n'.repeat(600))

    expect(store.getState().taskNoteByTaskKey['AX-3423']).toBe('n'.repeat(500))
  })

  it('skips the write when nothing changed', () => {
    const setMock = stubUiSet()
    const store = createUIStore()

    store.getState().setTaskNote('AX-3423', '')
    store.getState().setTaskNote('AX-3423', '   ')
    expect(setMock).not.toHaveBeenCalled()

    store.getState().setTaskNote('AX-3423', 'POS Action Wear')
    store.getState().setTaskNote('AX-3423', ' POS Action Wear ')
    expect(setMock).toHaveBeenCalledTimes(1)
  })

  it('ignores task keys that hydration would drop', () => {
    const setMock = stubUiSet()
    const store = createUIStore()

    store.getState().setTaskNote('', 'note')
    store.getState().setTaskNote('x'.repeat(201), 'note')
    store.getState().setTaskNote('__proto__', 'note')

    expect(store.getState().taskNoteByTaskKey).toEqual({})
    expect(setMock).not.toHaveBeenCalled()
  })

  it('refuses a new note past the 500 entries hydration keeps, but still edits existing ones', () => {
    const setMock = stubUiSet()
    const store = createUIStore()
    const full = Object.fromEntries(Array.from({ length: 500 }, (_, i) => [`AX-${i}`, 'note']))
    store.getState().hydratePersistedUI(makePersistedUI({ taskNoteByTaskKey: full }))
    setMock.mockClear()

    store.getState().setTaskNote('AX-new', 'one too many')
    expect(store.getState().taskNoteByTaskKey['AX-new']).toBeUndefined()
    expect(setMock).not.toHaveBeenCalled()

    store.getState().setTaskNote('AX-0', 'edited')
    expect(store.getState().taskNoteByTaskKey['AX-0']).toBe('edited')
  })

  it('hydrates the persisted map and tolerates its absence', () => {
    const store = createUIStore()
    store.getState().hydratePersistedUI(
      makePersistedUI({
        taskNoteByTaskKey: { 'AX-3423': 'POS Action Wear', 'AX-3500': 'Kiosk refund flow' }
      })
    )
    expect(store.getState().taskNoteByTaskKey).toEqual({
      'AX-3423': 'POS Action Wear',
      'AX-3500': 'Kiosk refund flow'
    })

    store.getState().hydratePersistedUI(makePersistedUI({}))
    expect(store.getState().taskNoteByTaskKey).toEqual({})
  })

  it('sanitizes a hand-edited map on hydration', () => {
    const store = createUIStore()
    store.getState().hydratePersistedUI(
      makePersistedUI({
        // Bad values are what a hand-edited or newer-build ui.json can hold.
        taskNoteByTaskKey: JSON.parse('{"AX-1":" kept ","AX-2":"   ","AX-3":7,"":"x","AX-4":null}')
      })
    )
    expect(store.getState().taskNoteByTaskKey).toEqual({ 'AX-1': 'kept' })
  })
})

describe('sanitizeTaskNoteByTaskKey', () => {
  it('keeps trimmed non-empty notes under usable keys', () => {
    expect(
      sanitizeTaskNoteByTaskKey({
        'AX-1': '  POS Action Wear  ',
        'AX-2': '',
        'AX-3': '   ',
        'AX-4': 12,
        '': 'no key',
        ['k'.repeat(201)]: 'key too long',
        ['k'.repeat(200)]: 'longest key'
      })
    ).toEqual({ 'AX-1': 'POS Action Wear', ['k'.repeat(200)]: 'longest key' })
  })

  it('caps each note at 500 characters', () => {
    const sanitized = sanitizeTaskNoteByTaskKey({ 'AX-1': 'n'.repeat(900) })
    expect(sanitized['AX-1']).toBe('n'.repeat(500))
  })

  it('drops prototype-polluting keys', () => {
    const sanitized = sanitizeTaskNoteByTaskKey(JSON.parse('{"__proto__":"note","AX-1":"note"}'))
    expect(Object.keys(sanitized)).toEqual(['AX-1'])
    expect(Object.getPrototypeOf(sanitized)).toBe(Object.prototype)
  })

  it('caps the map at 500 entries', () => {
    const many = Object.fromEntries(Array.from({ length: 600 }, (_, i) => [`AX-${i}`, 'note']))
    const sanitized = sanitizeTaskNoteByTaskKey(many)
    expect(Object.keys(sanitized)).toHaveLength(500)
    expect(sanitized['AX-0']).toBe('note')
    expect(sanitized['AX-599']).toBeUndefined()
  })

  it('returns an empty map for anything that is not an object', () => {
    expect(sanitizeTaskNoteByTaskKey(null)).toEqual({})
    expect(sanitizeTaskNoteByTaskKey(undefined)).toEqual({})
    expect(sanitizeTaskNoteByTaskKey(['note'])).toEqual({})
    expect(sanitizeTaskNoteByTaskKey('note')).toEqual({})
  })
})

describe('normalizeTaskNote', () => {
  it('trims and returns null for nothing worth keeping', () => {
    expect(normalizeTaskNote(' a note ')).toBe('a note')
    expect(normalizeTaskNote('')).toBeNull()
    expect(normalizeTaskNote(' \n\t')).toBeNull()
    expect(normalizeTaskNote(undefined)).toBeNull()
  })

  it('does not leave trailing whitespace where the cap cuts', () => {
    expect(normalizeTaskNote(`${'n'.repeat(499)} tail`)).toBe('n'.repeat(499))
  })
})

describe('getTaskNote', () => {
  it('returns the stored note', () => {
    expect(getTaskNote({ 'AX-1': 'POS Action Wear', 'AX-2': 'Kiosk' }, 'AX-2')).toBe('Kiosk')
  })

  it('returns null for an unknown or missing task key', () => {
    expect(getTaskNote({ 'AX-1': 'note' }, 'AX-9')).toBeNull()
    expect(getTaskNote({ 'AX-1': 'note' }, null)).toBeNull()
    expect(getTaskNote({}, 'AX-1')).toBeNull()
  })

  it('does not read inherited properties', () => {
    expect(getTaskNote({}, 'constructor')).toBeNull()
    expect(getTaskNote({}, 'toString')).toBeNull()
  })
})
