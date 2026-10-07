import { Flashlight } from 'lucide-react'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { translate } from '@/i18n/i18n'
import type { WorktreeContextMenuModel } from './use-worktree-context-menu-model'
import { WorktreeSpotlightEnvSubMenu } from './WorktreeSpotlightEnvSubMenu'

export type WorktreeSpotlightMenuModel = Pick<
  WorktreeContextMenuModel,
  | 'handleForceSyncSpotlight'
  | 'handleToggleSpotlight'
  | 'isDeleting'
  | 'repo'
  | 'spotlight'
  | 'spotlightEligible'
  | 'spotlightHeldHere'
  | 'spotlightOffOnMain'
  | 'worktree'
>

/** The Spotlight entries of a single workspace's context menu. */
export function WorktreeSpotlightMenuItems({
  model
}: {
  model: WorktreeSpotlightMenuModel
}): React.JSX.Element {
  const {
    handleForceSyncSpotlight,
    handleToggleSpotlight,
    isDeleting,
    repo,
    spotlight,
    spotlightEligible,
    spotlightHeldHere,
    spotlightOffOnMain,
    worktree
  } = model
  return (
    <>
      {spotlightEligible || spotlightOffOnMain ? (
        <DropdownMenuItem
          onSelect={handleToggleSpotlight}
          disabled={isDeleting || spotlight.syncing}
        >
          <Flashlight className="size-3.5" />
          {spotlightHeldHere || spotlightOffOnMain
            ? translate(
                'auto.components.sidebar.WorktreeContextMenu.spotlightOff',
                'Turn Off Spotlight'
              )
            : translate(
                'auto.components.sidebar.WorktreeContextMenu.spotlightOn',
                'Spotlight This Workspace'
              )}
        </DropdownMenuItem>
      ) : null}
      {spotlightHeldHere && spotlight.rootDiverged && repo ? (
        <DropdownMenuItem
          variant="destructive"
          onSelect={handleForceSyncSpotlight}
          disabled={isDeleting || spotlight.syncing}
        >
          <Flashlight className="size-3.5" />
          {translate(
            'auto.components.sidebar.WorktreeContextMenu.spotlightForceSync',
            'Force Sync Spotlight (overwrite root changes)'
          )}
        </DropdownMenuItem>
      ) : null}
      {spotlightEligible ? (
        <WorktreeSpotlightEnvSubMenu worktree={worktree} disabled={isDeleting} />
      ) : null}
    </>
  )
}
