import { ipcMain } from 'electron'
import type { GitLineBlameResult } from '../../../shared/git-line-blame-types'
import { getFileBlame, getLineBlame } from '../../git/line-blame'
import { isGitRepo } from '../../git/repo'
import { getConnectionExecutionHostId } from '../../../shared/execution-host'
import { requireReachableGitRoute } from '../../providers/execution-host-provider-dispatch'
import type { Store } from '../../persistence/loading-store/store'
import { resolveAuthorizedPath } from './access/filesystem-auth'
import { resolveRegisteredWorktreePath } from '../worktrees/removal/registered-worktree-roots-cache'
import { validateGitRelativeFilePath } from './access/filesystem-path-containment'
import { getLocalGitOptionsForRegisteredWorktree } from '../local-worktree-runtime-options'
import { isFolderWorkspaceRootPath } from './filesystem-source-control-ai-targets'
import type { FilesystemHandlerContext } from './filesystem-handler-context'

// Why: blame must degrade to "no authorship" (null) instead of an access error —
// folder workspaces are legitimate non-worktree roots, and a plain folder may not
// be a git repo at all. Anything unresolvable simply has no blame.
async function resolveLineBlameLocalPath(
  store: Store,
  requestedPath: string
): Promise<string | null> {
  try {
    return await resolveRegisteredWorktreePath(requestedPath, store)
  } catch {
    if (!isFolderWorkspaceRootPath(store, requestedPath)) {
      return null
    }
    try {
      const resolved = await resolveAuthorizedPath(requestedPath, store)
      return isGitRepo(resolved) ? resolved : null
    } catch {
      return null
    }
  }
}

export function registerFilesystemGitBlameHandlers(context: FilesystemHandlerContext): void {
  const { store } = context

  ipcMain.handle(
    'git:fileBlame',
    async (
      _event,
      args: { worktreePath: string; filePath: string; connectionId?: string }
    ): Promise<Record<number, GitLineBlameResult> | null> => {
      requireReachableGitRoute(getConnectionExecutionHostId(args.connectionId))
      const worktreePath = await resolveLineBlameLocalPath(store, args.worktreePath)
      if (!worktreePath) {
        return null
      }
      const filePath = validateGitRelativeFilePath(worktreePath, args.filePath)
      const gitOptions = getLocalGitOptionsForRegisteredWorktree(
        store,
        args.worktreePath,
        worktreePath
      )
      return getFileBlame(worktreePath, filePath, gitOptions)
    }
  )

  ipcMain.handle(
    'git:lineBlame',
    async (
      _event,
      args: { worktreePath: string; filePath: string; line: number; connectionId?: string }
    ): Promise<GitLineBlameResult | null> => {
      requireReachableGitRoute(getConnectionExecutionHostId(args.connectionId))
      const worktreePath = await resolveLineBlameLocalPath(store, args.worktreePath)
      if (!worktreePath) {
        return null
      }
      const filePath = validateGitRelativeFilePath(worktreePath, args.filePath)
      const gitOptions = getLocalGitOptionsForRegisteredWorktree(
        store,
        args.worktreePath,
        worktreePath
      )
      return getLineBlame(worktreePath, filePath, args.line, gitOptions)
    }
  )
}
