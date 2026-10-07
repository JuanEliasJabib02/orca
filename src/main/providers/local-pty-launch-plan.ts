import { win32 as pathWin32 } from 'node:path'
import { canUseBunPty } from '../daemon/pty-subprocess/bun-pty-process-capabilities'
import { recognizeAgentProcessFromCommandLine } from '../../shared/agent-process-recognition'
import { getDefaultWslDistro, parseWslPath } from '../wsl'
import {
  getDefaultCwd,
  getWslContextFromPreferredDistro,
  getWslContextFromWorktreeId
} from './local-pty-launch-helpers'
import type { LocalPtyProviderOptions } from './local-pty-provider-types'
import type { getShellLaunchConfig } from './local-pty-shell-ready'
import { ensureNodePtySpawnHelperExecutable, validateWorkingDirectory } from './local-pty-utils'
import { selectWindowsShell } from './windows-shell-selection'
import { buildWindowsPowerShellSpawnAttempts } from './windows-shell-fallback-chain'
import { resolveWindowsShellLaunchArgs } from './windows-shell-args'
import { assertSafeAgentStartupCwd } from './pty-default-cwd'
import type { PtySpawnOptions } from './types'

type WslLaunchContext = { distro: string; treatPosixCwdAsWsl: true }
type LocalPtyLaunchSeed = {
  args: PtySpawnOptions
  startupAgentRecognition: ReturnType<typeof recognizeAgentProcessFromCommandLine>
  defaultCwd: string
  cwd: string
  wslInfo: ReturnType<typeof parseWslPath>
  worktreeWslContext: WslLaunchContext | undefined
  preferredWslContext: WslLaunchContext | undefined
  launchWslContext: WslLaunchContext | undefined
}

export type LocalPtyLaunchPlan = {
  startupAgentRecognition: ReturnType<typeof recognizeAgentProcessFromCommandLine>
  defaultCwd: string
  cwd: string
  wslInfo: ReturnType<typeof parseWslPath>
  worktreeWslContext: WslLaunchContext | undefined
  preferredWslContext: WslLaunchContext | undefined
  launchWslContext: WslLaunchContext | undefined
  shellPath: string
  shellArgs: string[]
  effectiveCwd: string
  validationCwd: string
  startupCommandDeliveredInShellArgs: boolean
  windowsFallbackAttempts: ReturnType<typeof buildWindowsPowerShellSpawnAttempts>
  shellReadyLaunch: ReturnType<typeof getShellLaunchConfig> | null
  getFallbackShellReadyConfig:
    | ((shell: string) => ReturnType<typeof getShellLaunchConfig>)
    | undefined
  // Why hoisted: a fallback shell must drop the primary's launch env, and
  // re-deriving the key names would re-run wrapper generation.
  primaryLaunchEnvKeys: string[]
  isWslShell: boolean
  launchWslDistro: string | null
}

export class DeferredLocalPtyLaunchPlan {
  constructor(
    readonly availability: boolean | Promise<boolean>,
    readonly finish: (available: boolean) => LocalPtyLaunchPlan
  ) {}
}

function finalizeLocalPtyLaunchPlan(
  seed: LocalPtyLaunchSeed,
  shell: {
    shellPath: string
    shellArgs: string[]
    effectiveCwd: string
    validationCwd: string
    startupCommandDeliveredInShellArgs?: boolean
    windowsFallbackAttempts?: ReturnType<typeof buildWindowsPowerShellSpawnAttempts>
  }
): LocalPtyLaunchPlan {
  if (!canUseBunPty()) {
    ensureNodePtySpawnHelperExecutable()
  }
  if (seed.args.prevalidatedCwd !== shell.validationCwd) {
    validateWorkingDirectory(shell.validationCwd)
  }
  const isWslShell =
    Boolean(seed.wslInfo) || pathWin32.basename(shell.shellPath).toLowerCase() === 'wsl.exe'
  return {
    startupAgentRecognition: seed.startupAgentRecognition,
    defaultCwd: seed.defaultCwd,
    cwd: seed.cwd,
    wslInfo: seed.wslInfo,
    worktreeWslContext: seed.worktreeWslContext,
    preferredWslContext: seed.preferredWslContext,
    launchWslContext: seed.launchWslContext,
    shellPath: shell.shellPath,
    shellArgs: shell.shellArgs,
    effectiveCwd: shell.effectiveCwd,
    validationCwd: shell.validationCwd,
    startupCommandDeliveredInShellArgs: shell.startupCommandDeliveredInShellArgs ?? false,
    windowsFallbackAttempts: shell.windowsFallbackAttempts ?? [],
    shellReadyLaunch: null,
    getFallbackShellReadyConfig: undefined,
    primaryLaunchEnvKeys: [],
    isWslShell,
    launchWslDistro: isWslShell ? (seed.launchWslContext?.distro ?? null) : null
  }
}

function createWindowsLocalPtyLaunchPlan(
  seed: LocalPtyLaunchSeed,
  getOptions: () => LocalPtyProviderOptions
): LocalPtyLaunchPlan | DeferredLocalPtyLaunchPlan {
  const { args, cwd, defaultCwd, worktreeWslContext } = seed
  // Why: shellOverride opens one tab in a non-default shell without changing the user's setting; it wins over the setting.
  const requestedShellFamily =
    args.shellOverride ||
    getOptions().getWindowsShell?.() ||
    process.env.COMSPEC ||
    'powershell.exe'
  const shellFamily = worktreeWslContext ? 'wsl.exe' : requestedShellFamily
  if (!seed.launchWslContext && pathWin32.basename(shellFamily).toLowerCase() === 'wsl.exe') {
    seed.launchWslContext = getWslContextFromPreferredDistro(getDefaultWslDistro())
  }
  const shellSelection = selectWindowsShell(
    shellFamily,
    getOptions().getWindowsPowerShellImplementation?.()
  )
  const finish = (pwshAvailable: boolean): LocalPtyLaunchPlan => {
    const shellPath = shellSelection.resolveShellPath(pwshAvailable)
    // Why: bare `pwsh.exe` resolves to the Store App Execution Alias stub whose spawn fails (code 5); use an absolute exe + cmd.exe fallback.
    const windowsFallbackAttempts = buildWindowsPowerShellSpawnAttempts({
      shellPath,
      cwd,
      defaultCwd,
      wslContext: seed.launchWslContext,
      startupCommand: args.command
    })
    const primaryAttempt = windowsFallbackAttempts[0]
    if (primaryAttempt) {
      return finalizeLocalPtyLaunchPlan(seed, {
        shellPath: primaryAttempt.shellPath,
        shellArgs: primaryAttempt.shellArgs,
        effectiveCwd: primaryAttempt.effectiveCwd,
        validationCwd: primaryAttempt.validationCwd,
        startupCommandDeliveredInShellArgs: primaryAttempt.startupCommandDeliveredInShellArgs,
        windowsFallbackAttempts
      })
    }
    const resolved = resolveWindowsShellLaunchArgs(
      shellPath,
      cwd,
      defaultCwd,
      seed.launchWslContext,
      args.command
    )
    return finalizeLocalPtyLaunchPlan(seed, {
      shellPath,
      shellArgs: resolved.shellArgs,
      effectiveCwd: resolved.effectiveCwd,
      validationCwd: resolved.validationCwd,
      startupCommandDeliveredInShellArgs: resolved.startupCommandDeliveredInShellArgs === true,
      windowsFallbackAttempts
    })
  }
  return shellSelection.shouldProbePwsh
    ? new DeferredLocalPtyLaunchPlan(getOptions().pwshAvailable?.() ?? false, finish)
    : finish(false)
}

export function createLocalPtyLaunchPlan(
  args: PtySpawnOptions,
  getOptions: () => LocalPtyProviderOptions
): LocalPtyLaunchPlan | DeferredLocalPtyLaunchPlan {
  const startupAgentRecognition = args.command
    ? recognizeAgentProcessFromCommandLine(args.command)
    : null

  const defaultCwd = getDefaultCwd()
  const cwd = args.cwd || defaultCwd
  // Why: gate on the effective cwd, not raw args.cwd — an omitted cwd becomes a safe default and must not be rejected as root-like.
  if (args.command && startupAgentRecognition) {
    assertSafeAgentStartupCwd(cwd, args.command)
  }
  const wslInfo = process.platform === 'win32' ? parseWslPath(cwd) : null
  const worktreeWslContext =
    process.platform === 'win32' ? getWslContextFromWorktreeId(args.worktreeId) : undefined
  const preferredWslContext =
    process.platform === 'win32'
      ? getWslContextFromPreferredDistro(args.terminalWindowsWslDistro)
      : undefined
  const seed: LocalPtyLaunchSeed = {
    args,
    startupAgentRecognition,
    defaultCwd,
    cwd,
    wslInfo,
    worktreeWslContext,
    preferredWslContext,
    launchWslContext:
      wslInfo !== null
        ? getWslContextFromPreferredDistro(wslInfo.distro)
        : (worktreeWslContext ?? preferredWslContext)
  }
  if (wslInfo) {
    const shellPath = 'wsl.exe'
    const resolved = resolveWindowsShellLaunchArgs(shellPath, cwd, defaultCwd)
    return finalizeLocalPtyLaunchPlan(seed, {
      shellPath,
      shellArgs: resolved.shellArgs,
      effectiveCwd: resolved.effectiveCwd,
      validationCwd: resolved.validationCwd
    })
  }
  if (process.platform === 'win32') {
    return createWindowsLocalPtyLaunchPlan(seed, getOptions)
  }
  const shellPath =
    args.shellOverride ||
    getOptions().getDefaultShell?.()?.trim() ||
    args.env?.SHELL ||
    process.env.SHELL ||
    '/bin/zsh'
  return finalizeLocalPtyLaunchPlan(seed, {
    shellPath,
    // Why: shellOverride here is already resolved from the setting, so it cannot
    // distinguish a one-off shell pick; the spawn path only sends args for the profile.
    shellArgs:
      !args.command && !args.launchAgent && args.terminalShellArgs !== undefined
        ? args.terminalShellArgs
        : ['-l'],
    effectiveCwd: cwd,
    validationCwd: cwd
  })
}
