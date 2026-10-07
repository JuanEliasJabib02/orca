import { Server } from 'lucide-react'
import {
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger
} from '@/components/ui/dropdown-menu'
import { translate } from '@/i18n/i18n'
import { getSpotlightEnvKey } from '@/lib/spotlight-env-key'
import { switchSpotlightEnv } from '@/lib/spotlight-env-switch'
import { useAppStore } from '@/store'
import { useAllWorktrees } from '@/store/selectors'
import { getSpotlightEnvForTask } from '@/store/slices/ui/ui-slice-spotlight-env-actions'
import { SPOTLIGHT_SERVER_ENVS } from '../../../../shared/spotlight-server-types'
import type { Worktree } from '../../../../shared/worktree/types'
import { getSpotlightEnvLabel } from './spotlight-env-labels'

/** Environment of the Spotlight servers: the workspace's task's, or its own when it has no task. */
export function WorktreeSpotlightEnvSubMenu({
  worktree,
  disabled
}: {
  worktree: Worktree
  disabled: boolean
}): React.JSX.Element | null {
  const allWorktrees = useAllWorktrees()
  const envKey = getSpotlightEnvKey(worktree, allWorktrees)
  const env = useAppStore((s) => getSpotlightEnvForTask(s.spotlightEnvByTaskKey, envKey))

  // Why null: an id too long to store as a key can't remember an environment.
  if (envKey === null) {
    return null
  }

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger disabled={disabled}>
        <Server className="size-3.5" />
        {translate(
          'auto.components.sidebar.WorktreeContextMenu.spotlightEnvironment',
          'Spotlight environment'
        )}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="w-32">
        <DropdownMenuRadioGroup value={env}>
          {SPOTLIGHT_SERVER_ENVS.map((option) => (
            <DropdownMenuRadioItem
              key={option}
              value={option}
              onSelect={() => switchSpotlightEnv(envKey, option)}
            >
              {getSpotlightEnvLabel(option)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  )
}
