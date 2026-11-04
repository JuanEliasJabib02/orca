import type { Repo } from '../../shared/repo-types'
import type { SpotlightGitContext } from '../../shared/spotlight-sync-core'
import type { Store } from '../persistence/loading-store/store'
import { getLocalProjectGitExecOptions } from '../workspaces/execution-host/project-runtime-git-options'
import { gitExecFileAsync } from './runner'
import { detectConflictOperation } from './source-control/git-conflict-operation'

/** Local/WSL transport binding for the Spotlight sync core. SSH repos will get
 *  a relay-backed context in a later phase. */
export function createLocalSpotlightGitContext(store: Store, repo: Repo): SpotlightGitContext {
  const { wslDistro } = getLocalProjectGitExecOptions(store, repo)
  return {
    git: async (args, cwd, opts) =>
      gitExecFileAsync(args, {
        cwd,
        ...(wslDistro ? { wslDistro } : {}),
        // Why: gitExecFileAsync replaces the base env when one is passed, so
        // merge over process.env to keep PATH/HOME while adding GIT_INDEX_FILE.
        ...(opts?.env ? { env: { ...process.env, ...opts.env } } : {})
      }),
    detectConflict: (path) => detectConflictOperation(path)
  }
}
