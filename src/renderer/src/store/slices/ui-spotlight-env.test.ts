import { afterEach, describe, expect, it, vi } from 'vitest'
import { createUIStore, makePersistedUI } from './ui-slice-test-harness'
import {
  getSpotlightEnvForTask,
  sanitizeSpotlightEnvByTaskKey
} from './ui/ui-slice-spotlight-env-actions'

afterEach(() => {
  vi.unstubAllGlobals()
})

function stubUiSet(): ReturnType<typeof vi.fn> {
  const setMock = vi.fn(() => Promise.resolve())
  vi.stubGlobal('window', { api: { ui: { set: setMock } } })
  return setMock
}

describe('Spotlight environment per task', () => {
  it('starts empty', () => {
    expect(createUIStore().getState().spotlightEnvByTaskKey).toEqual({})
  })

  it('remembers the environment per task and persists the whole map', () => {
    const setMock = stubUiSet()
    const store = createUIStore()

    store.getState().setSpotlightEnvForTask('AX-3447', 'dev')
    store.getState().setSpotlightEnvForTask('AX-3500', 'prod')

    expect(store.getState().spotlightEnvByTaskKey).toEqual({ 'AX-3447': 'dev', 'AX-3500': 'prod' })
    expect(setMock).toHaveBeenLastCalledWith({
      spotlightEnvByTaskKey: { 'AX-3447': 'dev', 'AX-3500': 'prod' }
    })
  })

  it('removes the key when the default environment is stored', () => {
    const setMock = stubUiSet()
    const store = createUIStore()

    store.getState().setSpotlightEnvForTask('AX-3447', 'dev')
    store.getState().setSpotlightEnvForTask('AX-3500', 'prod')
    store.getState().setSpotlightEnvForTask('AX-3447', 'local')

    expect(store.getState().spotlightEnvByTaskKey).toEqual({ 'AX-3500': 'prod' })
    expect(setMock).toHaveBeenLastCalledWith({ spotlightEnvByTaskKey: { 'AX-3500': 'prod' } })
  })

  it('skips the write when nothing changed', () => {
    const setMock = stubUiSet()
    const store = createUIStore()

    store.getState().setSpotlightEnvForTask('AX-3447', 'local')
    expect(setMock).not.toHaveBeenCalled()

    store.getState().setSpotlightEnvForTask('AX-3447', 'dev')
    store.getState().setSpotlightEnvForTask('AX-3447', 'dev')
    expect(setMock).toHaveBeenCalledTimes(1)
  })

  it('ignores task keys that hydration would drop', () => {
    const setMock = stubUiSet()
    const store = createUIStore()

    store.getState().setSpotlightEnvForTask('', 'dev')
    store.getState().setSpotlightEnvForTask('x'.repeat(201), 'dev')
    store.getState().setSpotlightEnvForTask('__proto__', 'dev')

    expect(store.getState().spotlightEnvByTaskKey).toEqual({})
    expect(setMock).not.toHaveBeenCalled()
  })

  it('hydrates the persisted map and tolerates its absence', () => {
    const store = createUIStore()
    store.getState().hydratePersistedUI(
      makePersistedUI({
        spotlightEnvByTaskKey: { 'AX-3447': 'dev', 'AX-3500': 'prod' }
      })
    )
    expect(store.getState().spotlightEnvByTaskKey).toEqual({ 'AX-3447': 'dev', 'AX-3500': 'prod' })

    store.getState().hydratePersistedUI(makePersistedUI({}))
    expect(store.getState().spotlightEnvByTaskKey).toEqual({})
  })

  it('sanitizes a hand-edited map on hydration', () => {
    const store = createUIStore()
    store.getState().hydratePersistedUI(
      makePersistedUI({
        // Bad values are what a hand-edited or newer-build ui.json can hold.
        spotlightEnvByTaskKey: JSON.parse('{"AX-1":"dev","AX-2":"staging","AX-3":7,"":"prod"}')
      })
    )
    expect(store.getState().spotlightEnvByTaskKey).toEqual({ 'AX-1': 'dev' })
  })
})

describe('sanitizeSpotlightEnvByTaskKey', () => {
  it('keeps known environments under usable keys', () => {
    expect(
      sanitizeSpotlightEnvByTaskKey({
        'AX-1': 'dev',
        'AX-2': 'staging',
        'AX-3': null,
        'AX-4': 'local',
        '': 'prod',
        ['k'.repeat(201)]: 'prod',
        ['k'.repeat(200)]: 'prod'
      })
    ).toEqual({ 'AX-1': 'dev', 'AX-4': 'local', ['k'.repeat(200)]: 'prod' })
  })

  it('drops prototype-polluting keys', () => {
    const sanitized = sanitizeSpotlightEnvByTaskKey(JSON.parse('{"__proto__":"dev","AX-1":"dev"}'))
    expect(Object.keys(sanitized)).toEqual(['AX-1'])
    expect(Object.getPrototypeOf(sanitized)).toBe(Object.prototype)
  })

  it('caps the map at 500 entries', () => {
    const many = Object.fromEntries(Array.from({ length: 600 }, (_, i) => [`AX-${i}`, 'dev']))
    const sanitized = sanitizeSpotlightEnvByTaskKey(many)
    expect(Object.keys(sanitized)).toHaveLength(500)
    expect(sanitized['AX-0']).toBe('dev')
    expect(sanitized['AX-599']).toBeUndefined()
  })

  it('returns an empty map for anything that is not an object', () => {
    expect(sanitizeSpotlightEnvByTaskKey(null)).toEqual({})
    expect(sanitizeSpotlightEnvByTaskKey(undefined)).toEqual({})
    expect(sanitizeSpotlightEnvByTaskKey(['dev'])).toEqual({})
    expect(sanitizeSpotlightEnvByTaskKey('dev')).toEqual({})
  })
})

describe('getSpotlightEnvForTask', () => {
  it('returns the stored environment', () => {
    expect(getSpotlightEnvForTask({ 'AX-1': 'dev', 'AX-2': 'prod' }, 'AX-2')).toBe('prod')
  })

  it('defaults to local for an unknown or missing task key', () => {
    expect(getSpotlightEnvForTask({ 'AX-1': 'dev' }, 'AX-9')).toBe('local')
    expect(getSpotlightEnvForTask({ 'AX-1': 'dev' }, null)).toBe('local')
    expect(getSpotlightEnvForTask({}, 'AX-1')).toBe('local')
  })

  it('does not read inherited properties', () => {
    expect(getSpotlightEnvForTask({}, 'constructor')).toBe('local')
    expect(getSpotlightEnvForTask({}, 'toString')).toBe('local')
  })
})
