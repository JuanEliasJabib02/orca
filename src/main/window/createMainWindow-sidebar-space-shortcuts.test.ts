import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', async () =>
  (await import('./createMainWindow-test-harness')).electronModuleMock()
)
vi.mock('@electron-toolkit/utils', async () =>
  (await import('./createMainWindow-test-harness')).electronToolkitUtilsMock()
)
vi.mock('./macos-tahoe-release', async () =>
  (await import('./createMainWindow-test-harness')).macosTahoeReleaseMock()
)
vi.mock('../app-icon', async () => (await import('./createMainWindow-test-harness')).appIconMock())
vi.mock('../browser/browser-manager', async () =>
  (await import('./createMainWindow-test-harness')).browserManagerMock()
)

import { createMainWindow } from './createMainWindow'
import { ipcMain } from 'electron'
import { resetExpectedTeardownStateForTest } from '../crash-reporting/expected-teardown-state'
import { browserWindowMock, resetMainWindowMocks } from './createMainWindow-test-harness'

type TerminalShortcutPolicy = 'orca-first' | 'terminal-first'

function keyDown(name: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: 'keyDown',
    code: name,
    key: name,
    meta: false,
    control: false,
    alt: false,
    shift: false,
    ...extra
  }
}

describe('createMainWindow sidebar space shortcuts', () => {
  const windowHandlers: Record<string, (...args: any[]) => void> = {}
  const webContents = {
    on: vi.fn((event: string, handler: (...args: any[]) => void) => {
      windowHandlers[event] = handler
    }),
    setZoomLevel: vi.fn(),
    setBackgroundThrottling: vi.fn(),
    invalidate: vi.fn(),
    setWindowOpenHandler: vi.fn(),
    send: vi.fn(),
    isDevToolsOpened: vi.fn(),
    openDevTools: vi.fn(),
    closeDevTools: vi.fn()
  }

  function setup(terminalShortcutPolicy: TerminalShortcutPolicy = 'orca-first'): void {
    browserWindowMock.mockImplementation(function () {
      return {
        webContents,
        on: vi.fn(),
        isDestroyed: vi.fn(() => false),
        isMaximized: vi.fn(() => true),
        isFullScreen: vi.fn(() => false),
        getSize: vi.fn(() => [1200, 800]),
        setSize: vi.fn(),
        maximize: vi.fn(),
        show: vi.fn(),
        loadFile: vi.fn(() => Promise.resolve()),
        loadURL: vi.fn(() => Promise.resolve())
      }
    })
    createMainWindow(
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: window creation only reads settings.terminalShortcutPolicy from this store in these cases.
      { getUI: () => ({}), getSettings: () => ({ terminalShortcutPolicy }) } as never
    )
  }

  function focusTerminal(): void {
    const setFocusedListener = vi
      .mocked(ipcMain.on)
      .mock.calls.find(([channel]) => channel === 'ui:setTerminalInputFocused')?.[1]
    expect(setFocusedListener).toBeTypeOf('function')
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the focus listener only reads event.sender to find the window.
    setFocusedListener?.({ sender: webContents } as never, true)
  }

  function press(input: Record<string, unknown>): ReturnType<typeof vi.fn> {
    const preventDefault = vi.fn()
    windowHandlers['before-input-event']({ preventDefault }, input)
    return preventDefault
  }

  beforeEach(() => {
    resetMainWindowMocks()
    resetExpectedTeardownStateForTest()
    vi.useRealTimers()
    webContents.send.mockClear()
    webContents.on.mockClear()
  })

  it('sends F1-F3 to the renderer as space indexes and swallows the keydown', () => {
    setup()

    const preventions = [press(keyDown('F1')), press(keyDown('F2')), press(keyDown('F3'))]

    expect(webContents.send.mock.calls).toEqual([
      ['ui:selectSidebarSpace', 0],
      ['ui:selectSidebarSpace', 1],
      ['ui:selectSidebarSpace', 2]
    ])
    for (const preventDefault of preventions) {
      expect(preventDefault).toHaveBeenCalledTimes(1)
    }
  })

  it('captures the key from a focused terminal under Orca-first so it never reaches the PTY', () => {
    setup('orca-first')
    focusTerminal()

    const preventDefault = press(keyDown('F2'))

    expect(preventDefault).toHaveBeenCalledTimes(1)
    expect(webContents.send.mock.calls).toEqual([
      ['ui:terminalShortcutCaptured', { actionId: 'sidebar.space.select2' }],
      ['ui:selectSidebarSpace', 1]
    ])
  })

  it('yields the key to a focused terminal under terminal-first', () => {
    setup('terminal-first')
    focusTerminal()

    const preventDefault = press(keyDown('F2'))

    expect(preventDefault).not.toHaveBeenCalled()
    expect(webContents.send).not.toHaveBeenCalled()
  })

  it('contains held-key repeats without re-sending the switch', () => {
    setup()

    const preventDefault = press(keyDown('F1', { isAutoRepeat: true }))

    expect(preventDefault).toHaveBeenCalledTimes(1)
    expect(webContents.send).not.toHaveBeenCalled()
  })

  it('ignores other function keys and modified F1', () => {
    setup()

    const preventions = [
      press(keyDown('F4')),
      press(keyDown('F1', { shift: true })),
      press(keyDown('F1', { alt: true }))
    ]

    for (const preventDefault of preventions) {
      expect(preventDefault).not.toHaveBeenCalled()
    }
    expect(webContents.send).not.toHaveBeenCalled()
  })
})
