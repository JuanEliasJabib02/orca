// Which shell a new local Windows terminal launches for the shell family it was asked for.
import { win32 as pathWin32 } from 'node:path'
import { WINDOWS_GIT_BASH_SHELL } from '../../shared/windows-terminal-shell'
import { resolveWindowsGitBashShellPath } from '../git-bash'
import {
  resolveEffectiveWindowsPowerShell,
  shouldProbeWindowsPowerShellAvailability,
  type WindowsPowerShellImplementation,
  type WindowsPowerShellShellFamily
} from './windows-powershell'

export type WindowsShellSelection = {
  /** Whether `resolveShellPath` depends on pwsh being installed. */
  shouldProbePwsh: boolean
  resolveShellPath: (pwshAvailable: boolean) => string
}

/** `shellFamily`: the override, the Default Shell setting, COMSPEC, or `powershell.exe`. */
export function selectWindowsShell(
  shellFamily: string,
  powerShellImplementation: WindowsPowerShellImplementation | undefined
): WindowsShellSelection {
  const normalizedShellFamily = pathWin32.basename(shellFamily).toLowerCase()
  const resolvedGitBashPath = resolveWindowsGitBashShellPath(shellFamily)
  // Why: normalize setting-value and path forms to the PowerShell family so the resolver can fall back to inbox powershell.exe.
  const resolvedShellFamily: WindowsPowerShellShellFamily =
    normalizedShellFamily === 'powershell.exe' || normalizedShellFamily === 'pwsh.exe'
      ? normalizedShellFamily
      : normalizedShellFamily === 'cmd.exe' || normalizedShellFamily === 'wsl.exe'
        ? normalizedShellFamily
        : undefined
  const shouldProbePwsh = shouldProbeWindowsPowerShellAvailability({
    shellFamily: resolvedShellFamily,
    implementation: powerShellImplementation
  })
  const shouldResolvePowerShellFamily =
    powerShellImplementation !== undefined || pathWin32.basename(shellFamily) === shellFamily
  return {
    shouldProbePwsh,
    resolveShellPath: (pwshAvailable) => {
      if (resolvedGitBashPath) {
        return resolvedGitBashPath
      }
      if (shellFamily === WINDOWS_GIT_BASH_SHELL) {
        return 'powershell.exe'
      }
      return shouldResolvePowerShellFamily
        ? (resolveEffectiveWindowsPowerShell({
            shellFamily: resolvedShellFamily,
            implementation: powerShellImplementation,
            pwshAvailable
          }) ?? shellFamily)
        : shellFamily
    }
  }
}
