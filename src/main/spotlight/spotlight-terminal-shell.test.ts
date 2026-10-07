import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GlobalSettings } from '../../shared/global-settings-types'

const pwsh = vi.hoisted(() => ({
  isPwshAvailableAsync: vi.fn(async (): Promise<boolean> => false)
}))

vi.mock('../pwsh', () => pwsh)

import {
  configureSpotlightTerminalShell,
  forgetSpotlightTerminalShell,
  getSpotlightTerminalShell,
  rememberSpotlightTerminalShell,
  resolveSpotlightQueuedLaunchShell
} from './spotlight-terminal-shell'

const REPO_ID = 'repo-1'
const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')
const originalComspec = process.env.COMSPEC

type ShellSettings = Partial<
  Pick<GlobalSettings, 'terminalWindowsShell' | 'terminalWindowsPowerShellImplementation'>
>

function onPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { configurable: true, value: platform })
}

function useSettings(settings: ShellSettings): void {
  configureSpotlightTerminalShell(() => settings)
}

beforeEach(() => {
  pwsh.isPwshAvailableAsync.mockReset()
  pwsh.isPwshAvailableAsync.mockResolvedValue(false)
  delete process.env.COMSPEC
  useSettings({
    terminalWindowsShell: 'powershell.exe',
    terminalWindowsPowerShellImplementation: 'auto'
  })
})

afterEach(() => {
  vi.useRealTimers()
  forgetSpotlightTerminalShell(REPO_ID)
  if (originalPlatform) {
    Object.defineProperty(process, 'platform', originalPlatform)
  }
  if (originalComspec === undefined) {
    delete process.env.COMSPEC
  } else {
    process.env.COMSPEC = originalComspec
  }
})

describe('resolveSpotlightQueuedLaunchShell', () => {
  it('is null off Windows, where every default shell chains with &&', async () => {
    onPlatform('darwin')

    expect(await resolveSpotlightQueuedLaunchShell()).toBeNull()
    expect(pwsh.isPwshAvailableAsync).not.toHaveBeenCalled()
  })

  it('resolves the PowerShell default like new local terminals: 5.1 without pwsh', async () => {
    onPlatform('win32')

    expect(await resolveSpotlightQueuedLaunchShell()).toBe('powershell.exe')
  })

  it('resolves PowerShell 7 when pwsh is available', async () => {
    onPlatform('win32')
    pwsh.isPwshAvailableAsync.mockResolvedValue(true)

    expect(await resolveSpotlightQueuedLaunchShell()).toBe('pwsh.exe')
  })

  it('honors an explicit Windows PowerShell choice even with pwsh installed', async () => {
    onPlatform('win32')
    pwsh.isPwshAvailableAsync.mockResolvedValue(true)
    useSettings({
      terminalWindowsShell: 'powershell.exe',
      terminalWindowsPowerShellImplementation: 'powershell.exe'
    })

    expect(await resolveSpotlightQueuedLaunchShell()).toBe('powershell.exe')
  })

  it('keeps a non-PowerShell default shell', async () => {
    onPlatform('win32')
    useSettings({
      terminalWindowsShell: 'cmd.exe',
      terminalWindowsPowerShellImplementation: 'auto'
    })

    expect(await resolveSpotlightQueuedLaunchShell()).toBe('cmd.exe')
  })

  it('falls back to Windows PowerShell when the pwsh probe is slow', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    onPlatform('win32')
    pwsh.isPwshAvailableAsync.mockReturnValue(new Promise<boolean>(() => {}))

    const resolving = resolveSpotlightQueuedLaunchShell()
    await vi.advanceTimersByTimeAsync(1000)

    expect(await resolving).toBe('powershell.exe')
  })
})

describe('getSpotlightTerminalShell', () => {
  it('prefers the shell last seen at the prompt of the Spotlight terminal', () => {
    onPlatform('win32')
    rememberSpotlightTerminalShell(REPO_ID, 'pwsh.exe')

    expect(getSpotlightTerminalShell(REPO_ID)).toBe('pwsh.exe')
  })

  it('falls back to the default without probing, reading an unknown pwsh as Windows PowerShell', () => {
    onPlatform('win32')

    expect(getSpotlightTerminalShell(REPO_ID)).toBe('powershell.exe')
    expect(pwsh.isPwshAvailableAsync).not.toHaveBeenCalled()
  })

  it('uses COMSPEC when no default shell is configured', () => {
    onPlatform('win32')
    process.env.COMSPEC = 'C:\\Windows\\System32\\cmd.exe'
    useSettings({})

    expect(getSpotlightTerminalShell(REPO_ID)).toBe('C:\\Windows\\System32\\cmd.exe')
  })

  it('is null off Windows without an observed shell', () => {
    onPlatform('linux')

    expect(getSpotlightTerminalShell(REPO_ID)).toBeNull()
  })
})
