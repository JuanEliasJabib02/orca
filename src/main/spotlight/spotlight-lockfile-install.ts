// Spotlight projects committed code onto the repo root but not node_modules, so a pnpm-lock.yaml
// change leaves the root's install stale, and a root never installed has none at all. The next
// server command Orca types or queues into the Spotlight terminal installs first in either case,
// where the user sees it run.
import { statSync } from 'node:fs'
import { join, win32 as pathWin32 } from 'node:path'
import { gitTry, type SpotlightGitContext } from '../../shared/spotlight-sync-primitives'

const PNPM_LOCKFILE = 'pnpm-lock.yaml'
const NODE_MODULES = 'node_modules'
const PNPM_INSTALL = 'pnpm install --frozen-lockfile'

const installPendingRepoIds = new Set<string>()
// For lines built with no terminal at hand (a queued launch, a restart's re-run).
const rootPathByRepoId = new Map<string, string>()

/** The repo's root as the latest Spotlight operation or terminal saw it. */
export function rememberSpotlightRoot(repoId: string, rootPath: string): void {
  rootPathByRepoId.set(repoId, rootPath)
}

/** A pnpm root with no node_modules directory: its server can't start before an install. Read on
 *  disk now; a stat failing for any reason but absence never asks for one. */
export function isSpotlightRootMissingDependencies(rootPath: string): boolean {
  try {
    const lockfile = statSync(join(rootPath, PNPM_LOCKFILE), { throwIfNoEntry: false })
    if (!lockfile?.isFile()) {
      return false
    }
    const nodeModules = statSync(join(rootPath, NODE_MODULES), { throwIfNoEntry: false })
    return nodeModules?.isDirectory() !== true
  } catch {
    return false
  }
}

/** Flag the repo when pnpm-lock.yaml differs between `fromSha` and `toSha` and exists in `toSha`.
 *  At most two bounded plumbing reads; a git failure never marks (nor blocks Spotlight).
 *  Every activation runs it, so it also remembers the root. Returns whether the repo was flagged. */
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
  // Prints the path only when it differs; gitTry reads a failure as null, i.e. "don't mark".
  const changed = await gitTry(ctx, rootPath, [
    'diff-tree',
    '--name-only',
    fromSha,
    toSha,
    '--',
    PNPM_LOCKFILE
  ])
  if (!changed) {
    return false
  }
  // A deleted lockfile also reads as changed, but there is nothing to install from.
  const lockfileBlob = await gitTry(ctx, rootPath, [
    'rev-parse',
    '--verify',
    '-q',
    `${toSha}:${PNPM_LOCKFILE}`
  ])
  if (!lockfileBlob) {
    return false
  }
  installPendingRepoIds.add(args.repoId)
  return true
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

/** The install, then `command` only if it succeeded, in syntax `shell` parses: zsh, bash, fish 3+,
 *  cmd and PowerShell 7 chain with `&&`. */
export function chainSpotlightInstall(command: string, shell: string | null | undefined): string {
  return isWindowsPowerShell51(shell)
    ? `${PNPM_INSTALL}; if ($?) { ${command} }`
    : `${PNPM_INSTALL} && ${command}`
}

/** Whether an install was pending, clearing it: it is handed out once per change. */
export function takeSpotlightInstallPending(repoId: string): boolean {
  return installPendingRepoIds.delete(repoId)
}

/** Whether the line about to be typed or queued installs first (once, whatever the reason): a
 *  pending lockfile change, taken here (`pendingTaken`), or a root without node_modules, checked
 *  now. A line that never runs hands back only `pendingTaken`; the disk is read again next time. */
export function takeSpotlightLaunchInstall(repoId: string): {
  install: boolean
  pendingTaken: boolean
} {
  const pendingTaken = takeSpotlightInstallPending(repoId)
  const rootPath = rootPathByRepoId.get(repoId)
  const missing =
    !pendingTaken && rootPath !== undefined && isSpotlightRootMissingDependencies(rootPath)
  return { install: pendingTaken || missing, pendingTaken }
}

/** `command`, with an install chained first when one is due (a pending one once per change). Call
 *  only when the line is about to be typed, so a skipped start keeps the install pending. */
export function takeSpotlightLaunchLine(
  repoId: string,
  command: string,
  shell: string | null | undefined
): string {
  return takeSpotlightLaunchInstall(repoId).install
    ? chainSpotlightInstall(command, shell)
    : command
}

export function isSpotlightInstallPending(repoId: string): boolean {
  return installPendingRepoIds.has(repoId)
}

/** Also puts back an install whose command never reached the terminal. */
export function markSpotlightInstallPending(repoId: string): void {
  installPendingRepoIds.add(repoId)
}

export function clearSpotlightInstallPending(repoId: string): void {
  installPendingRepoIds.delete(repoId)
}
