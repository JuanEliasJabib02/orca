import { ipcMain } from 'electron'
import type { Store } from '../../persistence'
import { isFolderRepo } from '../../../shared/repo-kind'
import {
  emptySpotlightServerScriptDetection,
  type SpotlightServerScriptDetection
} from '../../../shared/spotlight-server-types'
import { detectSpotlightServerScripts } from '../../spotlight/spotlight-server-script-detection'

export async function detectSpotlightServerScriptsForRepo(
  store: Pick<Store, 'getRepo'>,
  repoId: unknown
): Promise<SpotlightServerScriptDetection> {
  const repo = typeof repoId === 'string' ? store.getRepo(repoId) : undefined
  // Why: Spotlight only runs on local git repos, so folders and SSH repos have nothing to detect.
  if (!repo || isFolderRepo(repo) || repo.connectionId?.trim()) {
    return emptySpotlightServerScriptDetection()
  }
  return detectSpotlightServerScripts(repo.path)
}

export function registerRepoSpotlightServerScriptsHandler(store: Store): void {
  ipcMain.handle(
    'repos:detectSpotlightServerScripts',
    (_event, args: { repoId?: unknown } | undefined) =>
      detectSpotlightServerScriptsForRepo(store, args?.repoId)
  )
}
