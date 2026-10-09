import { afterEach, describe, expect, it, vi } from 'vitest'
import { createUIStore, makePersistedUI } from './ui-slice-test-harness'
import {
  getSpotlightVariantForTaskRepo,
  sanitizeSpotlightVariantByTaskRepo,
  toSpotlightVariantKey
} from './ui/ui-slice-spotlight-variant-actions'

afterEach(() => {
  vi.unstubAllGlobals()
})

function stubUiSet(): ReturnType<typeof vi.fn> {
  const setMock = vi.fn(() => Promise.resolve())
  vi.stubGlobal('window', { api: { ui: { set: setMock } } })
  return setMock
}

describe('Spotlight variant per task and repo', () => {
  it('starts empty', () => {
    expect(createUIStore().getState().spotlightVariantByTaskRepo).toEqual({})
  })

  it('remembers the variant per task and repo and persists the whole map', () => {
    const setMock = stubUiSet()
    const store = createUIStore()

    store.getState().setSpotlightVariantForTaskRepo('AX-3447', 'landing', 'do')
    store.getState().setSpotlightVariantForTaskRepo('AX-3500', 'landing', 'pt')

    const map = store.getState().spotlightVariantByTaskRepo
    expect(map).toEqual({ 'AX-3447::landing': 'do', 'AX-3500::landing': 'pt' })
    expect(getSpotlightVariantForTaskRepo(map, 'AX-3447', 'landing')).toBe('do')
    expect(getSpotlightVariantForTaskRepo(map, 'AX-3447', 'admin')).toBeNull()
    expect(getSpotlightVariantForTaskRepo(map, null, 'landing')).toBeNull()
    expect(setMock).toHaveBeenLastCalledWith({
      spotlightVariantByTaskRepo: { 'AX-3447::landing': 'do', 'AX-3500::landing': 'pt' }
    })
  })

  it('keys a workspace with no task by its own id, like the environment', () => {
    stubUiSet()
    const store = createUIStore()

    store.getState().setSpotlightVariantForTaskRepo('landing::/work/lone', 'landing', 'es')

    expect(store.getState().spotlightVariantByTaskRepo).toEqual({
      'landing::/work/lone::landing': 'es'
    })
  })

  it('skips the write when nothing changed', () => {
    const setMock = stubUiSet()
    const store = createUIStore()

    store.getState().setSpotlightVariantForTaskRepo('AX-3447', 'landing', 'do')
    store.getState().setSpotlightVariantForTaskRepo('AX-3447', 'landing', 'do')

    expect(setMock).toHaveBeenCalledTimes(1)
  })

  it('ignores unsafe variants and keys that cannot be stored', () => {
    const setMock = stubUiSet()
    const store = createUIStore()

    for (const variant of ['', 'do; rm -rf ~', '$(whoami)', 'd o', '{variant}', 'x'.repeat(65)]) {
      store.getState().setSpotlightVariantForTaskRepo('AX-3447', 'landing', variant)
    }
    store.getState().setSpotlightVariantForTaskRepo('', 'landing', 'do')
    store.getState().setSpotlightVariantForTaskRepo('__proto__', 'landing', 'do')
    store.getState().setSpotlightVariantForTaskRepo('x'.repeat(201), 'landing', 'do')
    store.getState().setSpotlightVariantForTaskRepo('AX-3447', '', 'do')

    expect(store.getState().spotlightVariantByTaskRepo).toEqual({})
    expect(setMock).not.toHaveBeenCalled()
  })

  it('makes room past the 500 entries hydration keeps by dropping the oldest choice', () => {
    const setMock = stubUiSet()
    const store = createUIStore()
    const full = Object.fromEntries(
      Array.from({ length: 500 }, (_, i) => [`AX-${i}::landing`, 'do'])
    )
    store.getState().hydratePersistedUI(makePersistedUI({ spotlightVariantByTaskRepo: full }))
    setMock.mockClear()

    store.getState().setSpotlightVariantForTaskRepo('AX-new', 'landing', 'pt')

    const map = store.getState().spotlightVariantByTaskRepo
    expect(Object.keys(map)).toHaveLength(500)
    expect(map['AX-0::landing']).toBeUndefined()
    expect(map['AX-new::landing']).toBe('pt')
    expect(Object.keys(map).at(-1)).toBe('AX-new::landing')
    expect(setMock).toHaveBeenCalledTimes(1)
  })

  it('moves a changed choice to the newest end', () => {
    stubUiSet()
    const store = createUIStore()

    store.getState().setSpotlightVariantForTaskRepo('AX-1', 'landing', 'do')
    store.getState().setSpotlightVariantForTaskRepo('AX-2', 'landing', 'do')
    store.getState().setSpotlightVariantForTaskRepo('AX-1', 'landing', 'gb')

    expect(Object.entries(store.getState().spotlightVariantByTaskRepo)).toEqual([
      ['AX-2::landing', 'do'],
      ['AX-1::landing', 'gb']
    ])
  })

  it('hydrates the persisted map, sanitized, and tolerates its absence', () => {
    const store = createUIStore()
    store.getState().hydratePersistedUI(
      makePersistedUI({
        // Bad values are what a hand-edited or newer-build ui.json can hold.
        spotlightVariantByTaskRepo: JSON.parse(
          '{"AX-1::landing":"do","AX-2::landing":"d o","AX-3::landing":7,"no-separator":"pt"}'
        )
      })
    )
    expect(store.getState().spotlightVariantByTaskRepo).toEqual({ 'AX-1::landing': 'do' })

    store.getState().hydratePersistedUI(makePersistedUI({}))
    expect(store.getState().spotlightVariantByTaskRepo).toEqual({})
  })
})

describe('sanitizeSpotlightVariantByTaskRepo', () => {
  it('keeps safe variants under `<envKey>::<repoId>` keys', () => {
    expect(
      sanitizeSpotlightVariantByTaskRepo({
        'AX-1::landing': 'do',
        'AX-2::landing': 'pt_2',
        'AX-3::landing': 'es; reboot',
        'AX-4::landing': null,
        'AX-5': 'gb',
        [`${'k'.repeat(399)}::r`]: 'gb',
        [`${'k'.repeat(397)}::r`]: 'br'
      })
    ).toEqual({ 'AX-1::landing': 'do', 'AX-2::landing': 'pt_2', [`${'k'.repeat(397)}::r`]: 'br' })
  })

  it('drops prototype-polluting keys and non-objects', () => {
    const sanitized = sanitizeSpotlightVariantByTaskRepo(
      JSON.parse('{"__proto__":"do","constructor":"do","AX-1::landing":"do"}')
    )
    expect(Object.keys(sanitized)).toEqual(['AX-1::landing'])
    expect(Object.getPrototypeOf(sanitized)).toBe(Object.prototype)
    expect(sanitizeSpotlightVariantByTaskRepo(['do'])).toEqual({})
    expect(sanitizeSpotlightVariantByTaskRepo('do')).toEqual({})
  })

  it('caps the map at 500 entries', () => {
    const many = Object.fromEntries(Array.from({ length: 600 }, (_, i) => [`AX-${i}::l`, 'do']))
    const sanitized = sanitizeSpotlightVariantByTaskRepo(many)
    expect(Object.keys(sanitized)).toHaveLength(500)
    expect(sanitized['AX-599::l']).toBeUndefined()
  })
})

describe('toSpotlightVariantKey', () => {
  it('joins the env key and the repo id, or refuses what cannot be stored', () => {
    expect(toSpotlightVariantKey('AX-3447', 'landing')).toBe('AX-3447::landing')
    expect(toSpotlightVariantKey(null, 'landing')).toBeNull()
    expect(toSpotlightVariantKey('AX-3447', '')).toBeNull()
    expect(toSpotlightVariantKey('x'.repeat(201), 'landing')).toBeNull()
  })
})
