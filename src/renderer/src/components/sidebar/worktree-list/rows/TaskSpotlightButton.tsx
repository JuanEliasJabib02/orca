import React, { useMemo, useState } from 'react'
import { Flashlight, Loader2 } from 'lucide-react'
import { useAppStore } from '@/store'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import type { TaskSectionInfo } from '../grouping/row-types'
import { resolveSidebarSpaceScopeFromState } from '../../sidebar-space-scope'
import { notifyTaskSpotlightBatch, runTaskSpotlightBatch } from './task-spotlight-batch'
import {
  isTaskSpotlightLit,
  resolveSwitchAwayRepos,
  resolveTaskSpotlightMembers
} from './task-spotlight-members'

// Why module-level: virtualized headers remount on scroll and would lose a per-instance busy flag.
const runningTaskKeys = new Set<string>()

/** Whole-task Spotlight: mirrors the task's worktree in every eligible project, or turns them all off when lit. */
export function TaskSpotlightButton({ task }: { task: TaskSectionInfo }): React.JSX.Element | null {
  const { taskKey } = task
  const repos = useAppStore((s) => s.repos)
  const worktreesByRepo = useAppStore((s) => s.worktreesByRepo)
  const activateSpotlight = useAppStore((s) => s.activateSpotlight)
  const deactivateSpotlight = useAppStore((s) => s.deactivateSpotlight)
  const { eligible, spotlightOffRepos } = useMemo(
    () => resolveTaskSpotlightMembers(task.worktrees, worktreesByRepo, repos),
    [task.worktrees, worktreesByRepo, repos]
  )
  // Why a boolean selector: the repo state is replaced on every sync, but lit flips rarely.
  const lit = useAppStore((s) => isTaskSpotlightLit(eligible, s.spotlightByRepo))
  const [running, setRunning] = useState(false)

  // Why null: "No task" has no key, and with no eligible project there is nothing to act on.
  if (taskKey === null || eligible.length === 0) {
    return null
  }

  const tooltip = running
    ? translate('auto.components.sidebar.TaskSpotlightButton.updating', 'Updating Spotlight…')
    : lit
      ? translate(
          'auto.components.sidebar.TaskSpotlightButton.active',
          'Spotlight on for this task. Click to turn it off in every project.'
        )
      : translate(
          'auto.components.sidebar.TaskSpotlightButton.activate',
          'Spotlight this task: mirror its workspaces onto their project roots for testing.'
        )
  const skippedNote =
    spotlightOffRepos.length > 0
      ? translate(
          'auto.components.sidebar.TaskSpotlightButton.skipped',
          'Skipped, Spotlight is off for: {{names}}',
          { names: spotlightOffRepos.map((repo) => repo.displayName).join(', ') }
        )
      : null

  const stopHeaderActivation = (event: React.SyntheticEvent): void => {
    event.stopPropagation()
  }

  const handleClick = (event: React.MouseEvent<HTMLButtonElement>): void => {
    stopHeaderActivation(event)
    if (running || runningTaskKeys.has(taskKey)) {
      return
    }
    runningTaskKeys.add(taskKey)
    setRunning(true)
    const state = useAppStore.getState()
    void runTaskSpotlightBatch({
      members: eligible,
      spotlightByRepo: state.spotlightByRepo,
      actions: { activateSpotlight, deactivateSpotlight },
      switchAway: resolveSwitchAwayRepos({
        eligible,
        spotlightByRepo: state.spotlightByRepo,
        repos: state.repos,
        spaceScope: resolveSidebarSpaceScopeFromState(state)
      })
    })
      .then((result) => notifyTaskSpotlightBatch(taskKey, result))
      .finally(() => {
        runningTaskKeys.delete(taskKey)
        setRunning(false)
      })
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          data-task-spotlight-button=""
          onPointerDown={stopHeaderActivation}
          onClick={handleClick}
          disabled={running}
          aria-label={skippedNote ? `${tooltip} ${skippedNote}` : tooltip}
          aria-pressed={lit}
          className={cn(
            'inline-flex size-4 items-center justify-center rounded bg-transparent transition-colors',
            lit
              ? 'text-status-warning hover:bg-status-warning-background'
              : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground focus-visible:bg-accent/60 focus-visible:text-foreground'
          )}
        >
          {running ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Flashlight className="size-3.5" />
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent side="right" sideOffset={8} className="max-w-72">
        <p>{tooltip}</p>
        {skippedNote ? <p>{skippedNote}</p> : null}
      </TooltipContent>
    </Tooltip>
  )
}
