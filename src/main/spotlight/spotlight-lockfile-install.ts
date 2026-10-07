// Spotlight projects committed code onto the repo root but not node_modules, so a pnpm-lock.yaml
// change leaves the root's install stale. The repo is flagged here, and the next server command
// Orca types into the Spotlight terminal installs first, where the user sees it run.
import { gitTry, type SpotlightGitContext } from '../../shared/spotlight-sync-primitives'

const PNPM_LOCKFILE = 'pnpm-lock.yaml'
// Windows PowerShell 5.1 has no `&&`; zsh, bash, fish, cmd and PowerShell 7 all chain with it.
export const SPOTLIGHT_INSTALL_PREFIX = 'pnpm install --frozen-lockfile && '

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

/** The install prefix once per change (clearing the flag), else ''. Call only when the
 *  command is about to be typed, so a skipped start keeps the install pending. */
export function takeSpotlightInstallPrefix(repoId: string): string {
  return installPendingRepoIds.delete(repoId) ? SPOTLIGHT_INSTALL_PREFIX : ''
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
