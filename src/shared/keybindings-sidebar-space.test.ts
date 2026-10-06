// Registry rows and matching for the F1-F3 sidebar space keys.
import { describe, expect, it } from 'vitest'
import {
  SIDEBAR_SPACE_KEYBINDING_ACTION_IDS,
  findKeybindingConflicts,
  formatKeybindingList,
  getEffectiveKeybindingsForAction,
  getKeybindingDefinition,
  getSidebarSpaceKeybindingActionId,
  isKeybindingPotentialTerminalConflict,
  keybindingMatchesAction,
  matchSidebarSpaceKeybindingIndex,
  normalizeKeybindingListForAction
} from './keybindings'

function functionKey(name: string, modifiers: { meta?: boolean; shift?: boolean } = {}) {
  return {
    key: name,
    code: name,
    meta: modifiers.meta ?? false,
    control: false,
    alt: false,
    shift: modifiers.shift ?? false
  }
}

describe('sidebar space keybindings', () => {
  it.each(['darwin', 'linux', 'win32'] as const)('binds F1-F3 by default on %s', (platform) => {
    expect(
      SIDEBAR_SPACE_KEYBINDING_ACTION_IDS.map((id) =>
        getEffectiveKeybindingsForAction(id, platform)
      )
    ).toEqual([['F1'], ['F2'], ['F3']])
    expect(formatKeybindingList(['F2'], platform)).toBe('F2')
  })

  it('registers every row as a remappable global action that terminals can conflict with', () => {
    for (const [index, actionId] of SIDEBAR_SPACE_KEYBINDING_ACTION_IDS.entries()) {
      const definition = getKeybindingDefinition(actionId)
      expect(definition).toMatchObject({
        title: `Switch to Space ${index + 1}`,
        group: 'Global',
        scope: 'global',
        allowBareKeybindings: true
      })
      expect(definition?.searchKeywords).toContain('space')
      expect(definition && isKeybindingPotentialTerminalConflict(definition)).toBe(true)
    }
  })

  it('accepts a bare function key as a remap and rejects bare letters', () => {
    expect(normalizeKeybindingListForAction('sidebar.space.select1', 'F5')).toEqual(['F5'])
    expect(normalizeKeybindingListForAction('sidebar.space.select1', 'A')).toMatchObject({
      ok: false
    })
  })

  it('introduces no default conflicts', () => {
    for (const platform of ['darwin', 'linux', 'win32'] as const) {
      expect(findKeybindingConflicts(platform)).toEqual([])
    }
  })

  it('reports a conflict when a space is remapped onto an existing chord', () => {
    expect(findKeybindingConflicts('linux', { 'sidebar.space.select1': ['Mod+P'] })).toContainEqual(
      {
        binding: 'Mod+P',
        actionIds: expect.arrayContaining(['worktree.quickOpen', 'sidebar.space.select1'])
      }
    )
  })

  it('matches only the unmodified function key', () => {
    expect(keybindingMatchesAction('sidebar.space.select1', functionKey('F1'), 'darwin')).toBe(true)
    expect(keybindingMatchesAction('sidebar.space.select1', functionKey('F2'), 'darwin')).toBe(
      false
    )
    expect(
      keybindingMatchesAction('sidebar.space.select1', functionKey('F1', { meta: true }), 'darwin')
    ).toBe(false)
    expect(
      keybindingMatchesAction('sidebar.space.select1', functionKey('F1', { shift: true }), 'linux')
    ).toBe(false)
  })

  it('maps an index to its action id and rejects out-of-range indexes', () => {
    expect(getSidebarSpaceKeybindingActionId(0)).toBe('sidebar.space.select1')
    expect(getSidebarSpaceKeybindingActionId(2)).toBe('sidebar.space.select3')
    for (const index of [3, -1, 1.5, Number.NaN]) {
      expect(getSidebarSpaceKeybindingActionId(index)).toBeNull()
    }
  })

  it('resolves the matched row to its zero-based index, honouring remaps', () => {
    expect(matchSidebarSpaceKeybindingIndex(functionKey('F1'), 'linux')).toBe(0)
    expect(matchSidebarSpaceKeybindingIndex(functionKey('F3'), 'linux')).toBe(2)
    expect(matchSidebarSpaceKeybindingIndex(functionKey('F4'), 'linux')).toBeNull()
    expect(
      matchSidebarSpaceKeybindingIndex(functionKey('F4'), 'linux', {
        'sidebar.space.select2': ['F4']
      })
    ).toBe(1)
    expect(
      matchSidebarSpaceKeybindingIndex(functionKey('F1'), 'linux', {
        'sidebar.space.select1': []
      })
    ).toBeNull()
  })
})
