import { ipcMain } from 'electron'
import type { Store } from '../persistence'
import type { Repo } from '../../shared/repo-types'
import type { WorktreeMeta } from '../../shared/worktree/meta-types'
import { isFolderRepo } from '../../shared/repo-kind'
import {
  noSpotlightVariantInference,
  type SpotlightVariantInference
} from '../../shared/spotlight-server-variant'
import { getDefaultBaseRefAsync } from '../git/repo-default-base-ref'
import { gitExecFileAsync, gitOptionalLocksDisabledEnv } from '../git/runner'
import {
  getLocalProjectWorktreeGitOptions,
  type LocalProjectWorktreeGitOptions
} from '../project-runtime-git-options'
import { detectSpotlightServerScripts } from '../spotlight/spotlight-server-script-detection'
import { worktreePathFromId } from '../spotlight/spotlight-service-state'
import { inferSpotlightVariant } from '../spotlight/spotlight-variant-inference'

const INFER_GIT_TIMEOUT_MS = 15_000
// Why: the diff is limited to apps/ already; a bigger answer is not worth reading to pick one app.
const INFER_GIT_MAX_BUFFER = 1024 * 1024

export type SpotlightVariantInferenceDeps = {
  store: {
    getRepo: Store['getRepo']
    getWorktreeMeta: (
      worktreeId: string
    ) => Pick<WorktreeMeta, 'baseRef' | 'sparseBaseRef'> | undefined
  }
  /** The project's git routing (WSL); throws when its runtime needs repair. */
  gitOptionsFor: (repo: Repo) => LocalProjectWorktreeGitOptions
}

/** The variant the worktree's branch works on, read from its own checkout. Local git repos only;
 *  anything else (or any failure) is ambiguous with no candidates. Never throws. */
export async function inferSpotlightVariantForWorktree(
  { store, gitOptionsFor }: SpotlightVariantInferenceDeps,
  repoId: string,
  worktreeId: string
): Promise<SpotlightVariantInference> {
  const repo = store.getRepo(repoId)
  const worktreePath = worktreePathFromId(repoId, worktreeId)
  if (!repo || isFolderRepo(repo) || repo.connectionId?.trim() || !worktreePath) {
    return noSpotlightVariantInference()
  }
  try {
    const { variants = [] } = await detectSpotlightServerScripts(repo.path)
    if (variants.length === 0) {
      return noSpotlightVariantInference()
    }
    const gitOptions = gitOptionsFor(repo)
    const meta = store.getWorktreeMeta(worktreeId)
    return await inferSpotlightVariant({
      variants,
      baseRefs: [meta?.baseRef, meta?.sparseBaseRef, repo.worktreeBaseRef],
      resolveDefaultBaseRef: () => getDefaultBaseRefAsync(repo.path, gitOptions),
      git: async (args) => {
        const { stdout } = await gitExecFileAsync(args, {
          cwd: worktreePath,
          ...gitOptions,
          // Why: an agent may be running git in this worktree; a read must not take its index lock.
          env: gitOptionalLocksDisabledEnv(),
          timeout: INFER_GIT_TIMEOUT_MS,
          maxBuffer: INFER_GIT_MAX_BUFFER
        })
        return stdout
      }
    })
  } catch (error) {
    console.warn('[spotlight] Could not infer the server variant:', error)
    return noSpotlightVariantInference()
  }
}

/** `canInfer` gates it to the worktree that holds the repo's active local Spotlight. */
export function registerSpotlightVariantHandler(
  store: Store,
  canInfer: (repoId: string, worktreeId: string) => boolean
): void {
  const deps: SpotlightVariantInferenceDeps = {
    store,
    gitOptionsFor: (repo) => getLocalProjectWorktreeGitOptions(store, repo)
  }
  ipcMain.removeHandler('spotlight:inferServerVariant')
  ipcMain.handle(
    'spotlight:inferServerVariant',
    async (_event, args: { repoId?: unknown; worktreeId?: unknown } | undefined) => {
      const repoId = args?.repoId
      const worktreeId = args?.worktreeId
      if (typeof repoId !== 'string' || typeof worktreeId !== 'string') {
        return noSpotlightVariantInference()
      }
      return canInfer(repoId, worktreeId)
        ? inferSpotlightVariantForWorktree(deps, repoId, worktreeId)
        : noSpotlightVariantInference()
    }
  )
}
