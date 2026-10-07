// Which shell the repo's Spotlight terminal runs, so a pending install is chained in syntax it parses.
import type { GlobalSettings } from '../../shared/global-settings-types'
import { withTimeout } from '../../shared/promise-timeout-fallback'
import { isPwshAvailableAsync } from '../pwsh'
import {
  selectWindowsShell,
  type WindowsShellSelection
} from '../providers/windows-shell-selection'

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

/** The shell a new local terminal spawns, selected like the local PTY launch plan. Null off
 *  Windows, where every default shell chains with `&&`. */
function selectDefaultShell(): WindowsShellSelection | null {
  if (process.platform !== 'win32') {
    return null
  }
  const settings = readSettings()
  return selectWindowsShell(
    settings?.terminalWindowsShell || process.env.COMSPEC || 'powershell.exe',
    settings?.terminalWindowsPowerShellImplementation ?? 'auto'
  )
}

/** For a launch queued before the Spotlight terminal's PTY exists. An unknown pwsh availability
 *  resolves to Windows PowerShell, whose chain PowerShell 7 parses too. */
export async function resolveSpotlightQueuedLaunchShell(): Promise<string | null> {
  const selection = selectDefaultShell()
  if (!selection) {
    return null
  }
  const pwshAvailable = selection.shouldProbePwsh
    ? await withTimeout(isPwshAvailableAsync(), PWSH_PROBE_TIMEOUT_MS, false)
    : false
  return selection.resolveShellPath(pwshAvailable)
}

/** For a line typed into a busy terminal (a restart's re-run), where no prompt is there to inspect. */
export function getSpotlightTerminalShell(repoId: string): string | null {
  return observedShellByRepoId.get(repoId) ?? selectDefaultShell()?.resolveShellPath(false) ?? null
}
