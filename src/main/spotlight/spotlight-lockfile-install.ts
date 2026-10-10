// Spotlight projects committed code onto the repo root but not installed dependencies, so a lockfile
// change leaves the root's install stale, and a root never installed has none at all. The next
// server command Orca types or queues into the Spotlight terminal installs first in either case,
// where the user sees it run. pnpm and uv: a Python dev server reloads on code but never installs.
import { statSync } from 'node:fs'
import { join, win32 as pathWin32 } from 'node:path'
import { gitTry, type SpotlightGitContext } from '../../shared/spotlight-sync-primitives'

/** A package manager whose lockfile the root's dependencies follow. */
export type SpotlightInstaller = 'pnpm' | 'uv'

type InstallerSpec = {
  lockfile: string
  /** The directory the install creates at the root. */
  installed: string
  install: string
  /** What the log tells the user to run by hand. */
  manualInstall: string
}

const INSTALLERS: Record<SpotlightInstaller, InstallerSpec> = {
  pnpm: {
    lockfile: 'pnpm-lock.yaml',
    installed: 'node_modules',
    install: 'pnpm install --frozen-lockfile',
    manualInstall: 'pnpm install'
  },
  uv: {
    lockfile: 'uv.lock',
    installed: '.venv',
    install: 'uv sync --frozen',
    manualInstall: 'uv sync'
  }
}

// Also the install order for a repo with both lockfiles.
const INSTALLER_ORDER: readonly SpotlightInstaller[] = ['pnpm', 'uv']

const pendingByRepoId = new Map<string, Set<SpotlightInstaller>>()
// For lines built with no terminal at hand (a queued launch, a restart's re-run).
const rootPathByRepoId = new Map<string, string>()

function inOrder(installers: Iterable<SpotlightInstaller>): SpotlightInstaller[] {
  const wanted = new Set(installers)
  return INSTALLER_ORDER.filter((installer) => wanted.has(installer))
}

/** The repo's root as the latest Spotlight operation or terminal saw it. */
export function rememberSpotlightRoot(repoId: string, rootPath: string): void {
  rootPathByRepoId.set(repoId, rootPath)
}

function isMissingInstall(rootPath: string, spec: InstallerSpec): boolean {
  try {
    const lockfile = statSync(join(rootPath, spec.lockfile), { throwIfNoEntry: false })
    if (!lockfile?.isFile()) {
      return false
    }
    const installed = statSync(join(rootPath, spec.installed), { throwIfNoEntry: false })
    return installed?.isDirectory() !== true
  } catch {
    return false
  }
}

/** Installers whose lockfile is at the root without what they install (node_modules, .venv): its
 *  server can't start before an install. Read on disk now; a stat failing for any reason but
 *  absence never asks for one. */
export function listSpotlightRootMissingInstalls(rootPath: string): SpotlightInstaller[] {
  return INSTALLER_ORDER.filter((installer) => isMissingInstall(rootPath, INSTALLERS[installer]))
}

export function isSpotlightRootMissingDependencies(rootPath: string): boolean {
  return listSpotlightRootMissingInstalls(rootPath).length > 0
}

/** Flag each lockfile that differs between `fromSha` and `toSha` and exists in `toSha`. One diff
 *  for every lockfile, then one read per changed one; a git failure never marks (nor blocks
 *  Spotlight). Every activation runs it, so it also remembers the root. True when any was flagged. */
export async function markSpotlightInstallIfLockfileChanged(args: {
  repoId: string
  ctx: SpotlightGitContext
  rootPath: string
  fromSha: string | null | undefined
  toSha: string
}): Promise<boolean> {
  const { ctx, rootPath, fromSha, toSha } = args
  rememberSpotlightRoot(args.repoId, rootPath)
  if (!fromSha || fromSha === toSha) {
    return false
  }
  const lockfiles = INSTALLER_ORDER.map((installer) => INSTALLERS[installer].lockfile)
  // Prints only the paths that differ; gitTry reads a failure as null, i.e. "don't mark".
  const changed = await gitTry(ctx, rootPath, [
    'diff-tree',
    '--name-only',
    fromSha,
    toSha,
    '--',
    ...lockfiles
  ])
  const changedPaths = new Set((changed ?? '').split(/\r?\n/).map((line) => line.trim()))
  let flagged = false
  for (const installer of INSTALLER_ORDER) {
    const { lockfile } = INSTALLERS[installer]
    if (!changedPaths.has(lockfile)) {
      continue
    }
    // A deleted lockfile also reads as changed, but there is nothing to install from.
    const lockfileBlob = await gitTry(ctx, rootPath, [
      'rev-parse',
      '--verify',
      '-q',
      `${toSha}:${lockfile}`
    ])
    if (lockfileBlob) {
      markSpotlightInstallPending(args.repoId, [installer])
      flagged = true
    }
  }
  return flagged
}

/** Windows PowerShell 5.1 (`powershell.exe`) rejects `&&`, so neither half would run. `shell` is a
 *  process name or path; null means unknown. */
export function isWindowsPowerShell51(shell: string | null | undefined): boolean {
  if (process.platform !== 'win32' || !shell) {
    return false
  }
  const name = pathWin32.basename(shell.trim()).toLowerCase()
  return name === 'powershell' || name === 'powershell.exe'
}

/** The installs in order, then `command`, each only if the previous one succeeded, in syntax `shell`
 *  parses: zsh, bash, fish 3+, cmd and PowerShell 7 chain with `&&`. No installs: `command` alone. */
export function chainSpotlightInstall(
  command: string,
  shell: string | null | undefined,
  installers: readonly SpotlightInstaller[]
): string {
  const powershell51 = isWindowsPowerShell51(shell)
  return inOrder(installers).reduceRight((rest, installer) => {
    const install = INSTALLERS[installer].install
    return powershell51 ? `${install}; if ($?) { ${rest} }` : `${install} && ${rest}`
  }, command)
}

/** The installs pending for the repo, clearing them: each is handed out once per change. */
export function takeSpotlightInstallPending(repoId: string): SpotlightInstaller[] {
  const pending = pendingByRepoId.get(repoId)
  pendingByRepoId.delete(repoId)
  return pending ? inOrder(pending) : []
}

/** What the line about to be typed or queued installs first, each once whatever the reason: a
 *  pending lockfile change, taken here (`taken`), or a root missing that install, checked now. A
 *  line that never runs hands back only `taken`; the disk is read again next time. */
export function takeSpotlightLaunchInstall(repoId: string): {
  installers: SpotlightInstaller[]
  taken: SpotlightInstaller[]
} {
  const taken = takeSpotlightInstallPending(repoId)
  const rootPath = rootPathByRepoId.get(repoId)
  const missing = rootPath === undefined ? [] : listSpotlightRootMissingInstalls(rootPath)
  return { installers: inOrder([...taken, ...missing]), taken }
}

/** `command`, with the installs that are due chained first (a pending one once per change). Call
 *  only when the line is about to be typed, so a skipped start keeps the install pending. */
export function takeSpotlightLaunchLine(
  repoId: string,
  command: string,
  shell: string | null | undefined
): string {
  return chainSpotlightInstall(command, shell, takeSpotlightLaunchInstall(repoId).installers)
}

export function isSpotlightInstallPending(repoId: string): boolean {
  return (pendingByRepoId.get(repoId)?.size ?? 0) > 0
}

/** Also puts back installs whose command never reached the terminal. */
export function markSpotlightInstallPending(
  repoId: string,
  installers: readonly SpotlightInstaller[]
): void {
  if (installers.length === 0) {
    return
  }
  const pending = pendingByRepoId.get(repoId) ?? new Set<SpotlightInstaller>()
  for (const installer of installers) {
    pending.add(installer)
  }
  pendingByRepoId.set(repoId, pending)
}

export function clearSpotlightInstallPending(repoId: string): void {
  pendingByRepoId.delete(repoId)
}

/** For a server started by hand, which Orca never interrupts: what the user should run. */
export function describeSpotlightPendingInstall(repoId: string): string {
  const specs = inOrder(pendingByRepoId.get(repoId) ?? []).map((installer) => INSTALLERS[installer])
  const lockfiles = specs.map((spec) => spec.lockfile).join(' and ')
  const installs = specs.map((spec) => `"${spec.manualInstall}"`).join(' and ')
  return `${lockfiles} changed — stop the server, run ${installs}, then start it again`
}
