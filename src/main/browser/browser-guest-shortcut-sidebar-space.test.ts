import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { KeybindingOverrides } from '../../shared/keybindings'

vi.mock('electron', () => ({
  screen: { getCursorScreenPoint: vi.fn(() => ({ x: 0, y: 0 })) },
  webContents: { fromId: vi.fn() }
}))

import { setupGuestShortcutForwarding } from './browser-guest-shortcut-forwarding'

type BeforeInputListener = (event: Electron.Event, input: Electron.Input) => void

// oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the shortcut forwarder only reaches on/off on the guest and send on the renderer, which the caller supplies.
const fakeWebContents = (members: object): Electron.WebContents => members as Electron.WebContents

// oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the forwarder only calls preventDefault on the event.
const fakeEvent = (preventDefault: () => void): Electron.Event => ({ preventDefault }) as never

function keyDown(name: string, extra: Partial<Electron.Input> = {}): Electron.Input {
  return {
    type: 'keyDown',
    key: name,
    code: name,
    isAutoRepeat: false,
    isComposing: false,
    shift: false,
    control: false,
    alt: false,
    meta: false,
    location: 0,
    modifiers: [],
    ...extra
  }
}

describe('guest sidebar space shortcuts', () => {
  let rendererSend: ReturnType<typeof vi.fn>
  let beforeInput: BeforeInputListener | undefined

  function setup(keybindings?: KeybindingOverrides): void {
    const guest = fakeWebContents({
      on: (channel: string, listener: BeforeInputListener) => {
        if (channel === 'before-input-event') {
          beforeInput = listener
        }
      },
      off: vi.fn()
    })
    setupGuestShortcutForwarding({
      browserTabId: 'tab-1',
      guest,
      resolveRenderer: () => fakeWebContents({ send: rendererSend }),
      getKeybindings: () => keybindings
    })
  }

  function press(input: Electron.Input): ReturnType<typeof vi.fn> {
    expect(beforeInput).toBeTypeOf('function')
    const preventDefault = vi.fn()
    beforeInput?.(fakeEvent(preventDefault), input)
    return preventDefault
  }

  beforeEach(() => {
    rendererSend = vi.fn()
    beforeInput = undefined
  })

  it('forwards F1-F3 from a focused guest as space indexes and keeps the key from the page', () => {
    setup()

    const preventions = [press(keyDown('F1')), press(keyDown('F2')), press(keyDown('F3'))]

    expect(rendererSend.mock.calls).toEqual([
      ['ui:selectSidebarSpace', 0],
      ['ui:selectSidebarSpace', 1],
      ['ui:selectSidebarSpace', 2]
    ])
    for (const preventDefault of preventions) {
      expect(preventDefault).toHaveBeenCalledTimes(1)
    }
  })

  it('follows a remapped space key', () => {
    setup({ 'sidebar.space.select1': ['F5'] })

    const remapped = press(keyDown('F5'))
    const oldDefault = press(keyDown('F1'))

    expect(rendererSend.mock.calls).toEqual([['ui:selectSidebarSpace', 0]])
    expect(remapped).toHaveBeenCalledTimes(1)
    expect(oldDefault).not.toHaveBeenCalled()
  })

  it('swallows held-key repeats instead of re-sending or leaking them to the page', () => {
    setup()

    const preventDefault = press(keyDown('F2', { isAutoRepeat: true }))

    expect(preventDefault).toHaveBeenCalledTimes(1)
    expect(rendererSend).not.toHaveBeenCalled()
  })

  it('leaves other function keys to the page', () => {
    setup()

    const preventDefault = press(keyDown('F4'))

    expect(preventDefault).not.toHaveBeenCalled()
    expect(rendererSend).not.toHaveBeenCalled()
  })
})
