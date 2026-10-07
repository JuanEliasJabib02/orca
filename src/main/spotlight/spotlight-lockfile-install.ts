// Spotlight projects committed code onto the repo root but not node_modules, so a pnpm-lock.yaml
// change leaves the root's install stale. The repo is flagged here, and the next server command
// Orca types into the Spotlight terminal installs first, where the user sees it run.
import { win32 as pathWin32 } from 'node:path'
import { gitTry, type SpotlightGitContext } from '../../shared/spotlight-sync-primitives'

const PNPM_LOCKFILE = 'pnpm-lock.yaml'
const PNPM_INSTALL = 'pnpm install --frozen-lockfile'

const installPendingRepoIds = new Set<string>()

/** Flag the repo when pnpm-lock.yaml differs between `fromSha` and `toSha` and exists in `toSha`.
 *  At most two bounded plumbing reads; a git failure never marks (nor blocks Spotlight).
 *  Returns whether the repo was flagged. */
export async function markSpotlightInstallIfLockfileChanged(args: {
  repoId: string
  ctx: SpotlightGitContext
  rootPath: string
  fromSha: string | null | undefined
  toSha: string
}): Promise<boolean> {
  const { ctx, rootPath, fromSha, toSha } = args
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

/** `command`, with a pending install chained first (once per change). Call only when the line is
 *  about to be typed, so a skipped start keeps the install pending. */
export function takeSpotlightLaunchLine(
  repoId: string,
  command: string,
  shell: string | null | undefined
): string {
  return takeSpotlightInstallPending(repoId) ? chainSpotlightInstall(command, shell) : command
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
