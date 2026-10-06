import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { StoreApi } from 'zustand/vanilla'
import type { ProjectGroup } from '../../../../shared/project-group-types'
import type { AppState } from '../types'
import { createUIStore, makePersistedUI } from './ui-slice-test-harness'

function makeSpace(
  id: string,
  tabOrder: number,
  parentGroupId: string | null = null
): ProjectGroup {
  return {
    id,
    name: id,
    parentPath: null,
    parentGroupId,
    createdFrom: 'manual',
    tabOrder,
    isCollapsed: false,
    color: null,
    createdAt: 1,
    updatedAt: 1
  }
}

const SPACES = [makeSpace('arctic', 0), makeSpace('action', 1), makeSpace('nested', 2, 'arctic')]

let setUI: ReturnType<typeof vi.fn>

function createSpacesStore(activeSpaceId: string | null = 'arctic'): StoreApi<AppState> {
  const store = createUIStore()
  store.setState({ projectGroups: SPACES, activeSidebarSpaceGroupId: activeSpaceId })
  return store
}

beforeEach(() => {
  setUI = vi.fn(() => Promise.resolve())
  vi.stubGlobal('window', { api: { ui: { set: setUI } } })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Group by remembered per space', () => {
  it('records a Group by change for the active space only', () => {
    const store = createSpacesStore()

    store.getState().setGroupBy('task')

    expect(store.getState().groupBy).toBe('task')
    expect(store.getState().groupByBySpaceId).toEqual({ arctic: 'task' })
    expect(setUI).toHaveBeenCalledWith({ groupBy: 'task', collapsedGroups: [] })
    expect(setUI).toHaveBeenCalledWith({ groupByBySpaceId: { arctic: 'task' } })
  })

  it('applies each space its own Group by when switching', () => {
    const store = createSpacesStore()
    store.getState().setGroupBy('task')
    store.getState().setActiveSidebarSpaceGroupId('action')
    store.getState().setGroupBy('pr-status')

    store.getState().setActiveSidebarSpaceGroupId('arctic')
    expect(store.getState().groupBy).toBe('task')

    store.getState().setActiveSidebarSpaceGroupId('action')
    expect(store.getState().groupBy).toBe('pr-status')
    expect(store.getState().groupByBySpaceId).toEqual({ arctic: 'task', action: 'pr-status' })
  })

  it('goes through setGroupBy on a switch, so stale collapsed sections are cleared', () => {
    const store = createSpacesStore()
    store.setState({ groupByBySpaceId: { action: 'workspace-status' } })
    store.setState({ collapsedGroups: new Set(['repo:repo-1']) })

    store.getState().setActiveSidebarSpaceGroupId('action')

    expect(store.getState().groupBy).toBe('workspace-status')
    expect([...store.getState().collapsedGroups]).toEqual([])
    expect(setUI).toHaveBeenCalledWith({ groupBy: 'workspace-status', collapsedGroups: [] })
  })

  it('keeps collapsed sections when the entering space already shows the same Group by', () => {
    const store = createSpacesStore()
    store.setState({ groupByBySpaceId: { action: 'repo' }, collapsedGroups: new Set(['repo:r']) })

    store.getState().setActiveSidebarSpaceGroupId('action')

    expect(store.getState().groupBy).toBe('repo')
    expect([...store.getState().collapsedGroups]).toEqual(['repo:r'])
  })

  it('remembers what a space was showing when it is left before any choice', () => {
    const store = createSpacesStore()

    store.getState().setActiveSidebarSpaceGroupId('action')
    store.getState().setGroupBy('task')
    store.getState().setActiveSidebarSpaceGroupId('arctic')

    expect(store.getState().groupBy).toBe('repo')
    expect(store.getState().groupByBySpaceId).toEqual({ arctic: 'repo', action: 'task' })
  })

  it('keeps the current Group by when the entering space has none remembered', () => {
    const store = createSpacesStore()
    store.getState().setGroupBy('pr-status')

    store.getState().setActiveSidebarSpaceGroupId('action')

    expect(store.getState().groupBy).toBe('pr-status')
  })

  it('resolves a nested or unknown id to the space the switcher shows', () => {
    const store = createSpacesStore(null)
    store.setState({ groupByBySpaceId: { arctic: 'none' } })

    // Settling an unset id on the first space is what the normalization hook does at startup.
    store.getState().setActiveSidebarSpaceGroupId('arctic')
    expect(store.getState().groupBy).toBe('none')

    store.getState().setGroupBy('task')
    store.getState().setActiveSidebarSpaceGroupId('nested')
    expect(store.getState().groupByBySpaceId).toEqual({ arctic: 'task' })
  })

  it('leaves Group by global when there are no spaces', () => {
    const store = createUIStore()

    store.getState().setGroupBy('task')
    store.getState().setActiveSidebarSpaceGroupId('ghost')

    expect(store.getState().groupBy).toBe('task')
    expect(store.getState().groupByBySpaceId).toEqual({})
    expect(setUI).not.toHaveBeenCalledWith(
      expect.objectContaining({ groupByBySpaceId: expect.anything() })
    )
  })
})

describe('hydrating the per-space Group by', () => {
  it('restores known modes and drops malformed entries', () => {
    const store = createUIStore()

    store.getState().hydratePersistedUI(
      makePersistedUI({
        groupBy: 'task',
        groupByBySpaceId: {
          arctic: 'task',
          action: 'pr-status',
          // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: simulates a value from another build; hydration must drop it at runtime.
          stale: 'kanban' as never,
          '': 'repo'
        }
      })
    )

    expect(store.getState().groupBy).toBe('task')
    expect(store.getState().groupByBySpaceId).toEqual({ arctic: 'task', action: 'pr-status' })
  })

  it('treats an absent or non-object map as empty', () => {
    const store = createUIStore()
    store.getState().hydratePersistedUI(makePersistedUI({ groupByBySpaceId: { arctic: 'none' } }))

    store.getState().hydratePersistedUI(makePersistedUI({ groupByBySpaceId: undefined }))
    expect(store.getState().groupByBySpaceId).toEqual({})

    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: simulates a hand-edited ui.json.
    store.getState().hydratePersistedUI(makePersistedUI({ groupByBySpaceId: 'task' as never }))
    expect(store.getState().groupByBySpaceId).toEqual({})
  })
})
