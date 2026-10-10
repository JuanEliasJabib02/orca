import type { FolderWorkspacePathStatus } from '../../../../../../shared/folder-workspace-path-status'
import { isConfirmedStaleFolderPathStatus } from '../../../../../../shared/folder-workspace-path-status'

// The folder-scan project group whose parent path is gone can't create new workspaces.
export function isFolderWorkspaceCreateDisabled(status: FolderWorkspacePathStatus | null): boolean {
  return (
    status?.exists === false &&
    (isConfirmedStaleFolderPathStatus(status) || status.reason === 'ambiguous-connection')
  )
}
