// Which shell the repo's Spotlight terminal runs, so a pending install is chained in syntax it parses.
import { win32 as pathWin32 } from 'node:path'
import type { GlobalSettings } from '../../shared/global-settings-types'
import { withTimeout } from '../../shared/promise-timeout-fallback'
import { isPwshAvailableAsync } from '../pwsh'
import {
  resolveEffectiveWindowsPowerShell,
  type WindowsPowerShellShellFamily
} from '../providers/windows-powershell'

type SpotlightShellSettings = Partial<
  Pick<GlobalSettings, 'terminalWindowsShell' | 'terminalWindowsPowerShellImplementation'>
>

// A cold pwsh probe can take seconds; an unknown answer falls back to a chain both PowerShells parse.
const PWSH_PROBE_TIMEOUT_MS = 1000

let readSettings: () => SpotlightShellSettings | undefined = () => undefined
// The shell last seen idle at the prompt of the repo's Spotlight terminal.
const observedShellByRepoId = new Map<string, string>()

export function configureSpotlightTerminalShell(
  getSettings: () => SpotlightShellSettings | undefined
): void {
  readSettings = getSettings
}

export function rememberSpotlightTerminalShell(repoId: string, shell: string): void {
  observedShellByRepoId.set(repoId, shell)
}

export function forgetSpotlightTerminalShell(repoId: string): void {
  observedShellByRepoId.delete(repoId)
}

/** The shell a new local terminal spawns, resolved like the local PTY launch plan. Null off Windows,
 *  where every default shell chains with `&&`. An unknown pwsh availability resolves to Windows
 *  PowerShell, whose chain PowerShell 7 parses too. */
function resolveDefaultShell(pwshAvailable: boolean | null): string | null {
  if (process.platform !== 'win32') {
    return null
  }
  const settings = readSettings()
  const family = settings?.terminalWindowsShell || process.env.COMSPEC || 'powershell.exe'
  const normalized = pathWin32.basename(family).toLowerCase()
  const shellFamily: WindowsPowerShellShellFamily =
    normalized === 'powershell.exe' || normalized === 'pwsh.exe' ? normalized : undefined
  return (
    resolveEffectiveWindowsPowerShell({
      shellFamily,
      implementation: settings?.terminalWindowsPowerShellImplementation ?? 'auto',
      pwshAvailable: pwshAvailable ?? false
    }) ?? family
  )
}

/** For a launch queued before the Spotlight terminal's PTY exists. */
export async function resolveSpotlightQueuedLaunchShell(): Promise<string | null> {
  if (process.platform !== 'win32') {
    return null
  }
  return resolveDefaultShell(
    await withTimeout<boolean | null>(isPwshAvailableAsync(), PWSH_PROBE_TIMEOUT_MS, null)
  )
}

/** For a line typed into a busy terminal (a restart's re-run), where no prompt is there to inspect. */
export function getSpotlightTerminalShell(repoId: string): string | null {
  return observedShellByRepoId.get(repoId) ?? resolveDefaultShell(null)
}
