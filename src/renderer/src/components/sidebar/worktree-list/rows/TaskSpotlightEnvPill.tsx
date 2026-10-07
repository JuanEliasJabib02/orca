import React, { useMemo } from 'react'
import { ChevronDown } from 'lucide-react'
import { useAppStore } from '@/store'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import { switchSpotlightEnv } from '@/lib/spotlight-env-switch'
import { getSpotlightEnvForTask } from '@/store/slices/ui/ui-slice-spotlight-env-actions'
import {
  DEFAULT_SPOTLIGHT_SERVER_ENV,
  SPOTLIGHT_SERVER_ENVS
} from '../../../../../../shared/spotlight-server-types'
import { getSpotlightEnvLabel } from '../../spotlight-env-labels'
import type { TaskSectionInfo } from '../grouping/row-types'
import {
  handleRepoHeaderActionPointerDown,
  stopRepoHeaderKeyboardToggle,
  stopRepoHeaderMenuEvent
} from './header-event-guards'
import { isTaskSpotlightHeld, resolveTaskSpotlightMembers } from './task-spotlight-members'

/** Environment of a task's Spotlight servers (`Local ▾`); stays out of the way until it matters. */
export function TaskSpotlightEnvPill({
  task
}: {
  task: TaskSectionInfo
}): React.JSX.Element | null {
  const { taskKey } = task
  const repos = useAppStore((s) => s.repos)
  const worktreesByRepo = useAppStore((s) => s.worktreesByRepo)
  const env = useAppStore((s) => getSpotlightEnvForTask(s.spotlightEnvByTaskKey, taskKey))
  const { eligible } = useMemo(
    () => resolveTaskSpotlightMembers(task.worktrees, worktreesByRepo, repos),
    [task.worktrees, worktreesByRepo, repos]
  )
  // Why a boolean selector: the repo state is replaced on every sync, but holding flips rarely.
  const holding = useAppStore((s) =>
    eligible.some((member) => isTaskSpotlightHeld(member, s.spotlightByRepo))
  )

  // Why null: "No task" has no key, and with no eligible project there is no server to run.
  if (taskKey === null || eligible.length === 0) {
    return null
  }

  const alwaysShown = holding || env !== DEFAULT_SPOTLIGHT_SERVER_ENV
  const label = getSpotlightEnvLabel(env)

  return (
    <div
      data-task-spotlight-env=""
      // Why: a click in the pill's gutter must not toggle the section or arm a drag.
      data-repo-header-action=""
      className={cn(
        'flex shrink-0 items-center transition-[margin,max-width,opacity]',
        // Why -ml-1.5: cancels the label row's gap while collapsed so the header doesn't shift on hover; touch has no hover, so it never collapses there.
        !alwaysShown &&
          'can-hover:-ml-1.5 can-hover:max-w-0 can-hover:overflow-hidden can-hover:opacity-0 focus-within:ml-0 focus-within:max-w-24 focus-within:opacity-100 group-hover:ml-0 group-hover:max-w-24 group-hover:opacity-100 has-[[data-state=open]]:ml-0 has-[[data-state=open]]:max-w-24 has-[[data-state=open]]:opacity-100'
      )}
    >
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            data-task-spotlight-env-trigger=""
            aria-label={translate(
              'auto.components.sidebar.TaskSpotlightEnvPill.ariaLabel',
              'Spotlight environment for {{task}}: {{env}}',
              { task: taskKey, env: label }
            )}
            onClick={(event) => event.stopPropagation()}
            onKeyDown={stopRepoHeaderKeyboardToggle}
            onPointerDown={handleRepoHeaderActionPointerDown}
            className="inline-flex h-4 items-center gap-0.5 rounded px-1 text-[11px] leading-none text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground focus-visible:bg-accent/60 focus-visible:text-foreground data-[state=open]:bg-accent/60 data-[state=open]:text-foreground"
          >
            {label}
            <ChevronDown className="size-3" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          side="bottom"
          sideOffset={6}
          className="w-32"
          // Why: Radix portals keep React bubbling through the task header; block menu events from arming row drag/collapse.
          onPointerDown={stopRepoHeaderMenuEvent}
          onMouseDown={stopRepoHeaderMenuEvent}
          onPointerUp={stopRepoHeaderMenuEvent}
          onMouseUp={stopRepoHeaderMenuEvent}
          onClick={stopRepoHeaderMenuEvent}
          onKeyDown={stopRepoHeaderMenuEvent}
        >
          <DropdownMenuRadioGroup value={env}>
            {SPOTLIGHT_SERVER_ENVS.map((option) => (
              <DropdownMenuRadioItem
                key={option}
                value={option}
                onSelect={() => switchSpotlightEnv(taskKey, option)}
              >
                {getSpotlightEnvLabel(option)}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
