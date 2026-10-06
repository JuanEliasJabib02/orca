import { describe, expect, it } from 'vitest'
import {
  getWindowShortcutActionId,
  resolveWindowShortcutAction,
  windowShortcutActionCapturesTerminal
} from './window-shortcut-policy'

const platforms = ['darwin', 'linux', 'win32'] as const

function functionKey(
  name: string,
  modifiers: { meta?: boolean; control?: boolean; alt?: boolean; shift?: boolean } = {}
) {
  return {
    type: 'keyDown',
    key: name,
    code: name,
    meta: modifiers.meta ?? false,
    control: modifiers.control ?? false,
    alt: modifiers.alt ?? false,
    shift: modifiers.shift ?? false
  }
}

describe('sidebar space shortcuts', () => {
  it.each(platforms)('resolves F1, F2 and F3 to spaces 0, 1 and 2 on %s', (platform) => {
    expect(resolveWindowShortcutAction(functionKey('F1'), platform)).toEqual({
      type: 'selectSidebarSpace',
      index: 0
    })
    expect(resolveWindowShortcutAction(functionKey('F2'), platform)).toEqual({
      type: 'selectSidebarSpace',
      index: 1
    })
    expect(resolveWindowShortcutAction(functionKey('F3'), platform)).toEqual({
      type: 'selectSidebarSpace',
      index: 2
    })
  })

  it('leaves other function keys to the terminal', () => {
    expect(resolveWindowShortcutAction(functionKey('F4'), 'darwin')).toBeNull()
    expect(resolveWindowShortcutAction(functionKey('F12'), 'linux')).toBeNull()
  })

  it('does not match F1 with a modifier held unless that chord is bound', () => {
    for (const modifiers of [{ meta: true }, { control: true }, { alt: true }, { shift: true }]) {
      expect(resolveWindowShortcutAction(functionKey('F1', modifiers), 'darwin')).toBeNull()
    }
    expect(
      resolveWindowShortcutAction(functionKey('F1', { shift: true }), 'darwin', {
        'sidebar.space.select3': ['Shift+F1']
      })
    ).toEqual({ type: 'selectSidebarSpace', index: 2 })
  })

  it('follows a remapped binding and drops the default key', () => {
    const keybindings = { 'sidebar.space.select1': ['Mod+Alt+K'] }
    expect(
      resolveWindowShortcutAction(
        functionKey('K', { control: true, alt: true }),
        'linux',
        keybindings
      )
    ).toEqual({ type: 'selectSidebarSpace', index: 0 })
    expect(resolveWindowShortcutAction(functionKey('F1'), 'linux', keybindings)).toBeNull()
  })

  it('stops resolving a space whose binding was cleared', () => {
    expect(
      resolveWindowShortcutAction(functionKey('F2'), 'darwin', { 'sidebar.space.select2': [] })
    ).toBeNull()
  })

  it('maps each space back to its keybinding id', () => {
    expect(getWindowShortcutActionId({ type: 'selectSidebarSpace', index: 0 })).toBe(
      'sidebar.space.select1'
    )
    expect(getWindowShortcutActionId({ type: 'selectSidebarSpace', index: 2 })).toBe(
      'sidebar.space.select3'
    )
    expect(getWindowShortcutActionId({ type: 'selectSidebarSpace', index: 3 })).toBeNull()
  })

  it('captures the key from a focused terminal under Orca-first and yields under terminal-first', () => {
    const captures = windowShortcutActionCapturesTerminal({ type: 'selectSidebarSpace', index: 1 })
    expect(captures).toBe(true)
    expect(
      resolveWindowShortcutAction(functionKey('F2'), 'darwin', undefined, {
        context: 'terminal',
        terminalShortcutPolicy: 'orca-first'
      })
    ).toEqual({ type: 'selectSidebarSpace', index: 1 })
    expect(
      resolveWindowShortcutAction(functionKey('F2'), 'darwin', undefined, {
        context: 'terminal',
        terminalShortcutPolicy: 'terminal-first'
      })
    ).toBeNull()
  })

  it('does not capture an out-of-range space', () => {
    expect(windowShortcutActionCapturesTerminal({ type: 'selectSidebarSpace', index: 3 })).toBe(
      false
    )
  })
})
