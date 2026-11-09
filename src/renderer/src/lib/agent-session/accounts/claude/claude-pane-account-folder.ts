import type { ClaudeManagedAccount } from '../../../../../../shared/managed-account-types'
import {
  resolveClaudePaneFolder as resolveClaudePaneFolderOn,
  type ClaudeHostFolders,
  type ClaudePaneFolder
} from '../../../../../../shared/claude-pane-account-folder'
import { getRendererAppPlatform } from '../../../renderer-app-platform'

// Why shared: main reads the same folder rule to tell whether a paused pane ran out of usage.
export {
  isClaudePaneOnAccount,
  type ClaudeHostFolders,
  type ClaudePaneFolder
} from '../../../../../../shared/claude-pane-account-folder'

/** Undefined means no hook evidence; without the host's default home every unmanaged folder is System default. */
export function resolveClaudePaneFolder(
  transcriptPath: string | undefined,
  saved: readonly ClaudeManagedAccount[],
  host?: ClaudeHostFolders
): ClaudePaneFolder | undefined {
  return resolveClaudePaneFolderOn(transcriptPath, saved, host, getRendererAppPlatform())
}
