import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import {
  spotlightActivateFailedTitle,
  spotlightDeactivateFailedTitle
} from '@/store/slices/spotlight'
import type { Repo } from '../../../../../../shared/repo-types'
import type { SpotlightOpResult } from '../../../../../../shared/spotlight'
import {
  isTaskSpotlightHeld,
  isTaskSpotlightLit,
  type SpotlightHolders,
  type TaskSpotlightMember
} from './task-spotlight-members'

type TaskSpotlightOpOptions = { quiet?: boolean; projectName?: string }

export type TaskSpotlightActions = {
  activateSpotlight: (
    repoId: string,
    worktreeId: string,
    opts?: TaskSpotlightOpOptions
  ) => Promise<SpotlightOpResult>
  deactivateSpotlight: (repoId: string, opts?: TaskSpotlightOpOptions) => Promise<SpotlightOpResult>
}

export type TaskSpotlightBatchResult = {
  mode: 'on' | 'off'
  /** Projects the batch targeted. */
  total: number
  /** Targeted projects now in the requested state, ones that already were included. */
  succeeded: number
}

async function runOp(op: () => Promise<SpotlightOpResult>, failureTitle: string): Promise<boolean> {
  try {
    return (await op()).ok
  } catch (error) {
    // Why: the store action only toasts a failed result; a rejected IPC call must not go unseen.
    toast.error(failureTitle, {
      description: error instanceof Error ? error.message : String(error)
    })
    return false
  }
}

/** Turns the task's Spotlight on for every eligible project, or off everywhere when already lit.
 *  Turning on first switches off `switchAway` (the previous task's projects).
 *  Sequential, and a failing project never stops the rest. */
export async function runTaskSpotlightBatch(args: {
  members: readonly TaskSpotlightMember[]
  spotlightByRepo: SpotlightHolders | undefined
  actions: TaskSpotlightActions
  switchAway?: readonly Repo[]
}): Promise<TaskSpotlightBatchResult> {
  const { members, spotlightByRepo, actions, switchAway = [] } = args
  const held = members.filter((member) => isTaskSpotlightHeld(member, spotlightByRepo))

  if (isTaskSpotlightLit(members, spotlightByRepo)) {
    let succeeded = 0
    for (const { repo } of held) {
      // Why projectName: a batch spans repos, so every failure toast must say which one failed.
      const ok = await runOp(
        () => actions.deactivateSpotlight(repo.id, { quiet: true, projectName: repo.displayName }),
        spotlightDeactivateFailedTitle(repo.displayName)
      )
      succeeded += ok ? 1 : 0
    }
    return { mode: 'off', total: held.length, succeeded }
  }

  // Why the guard: a task with nothing to turn on must not switch the previous one off.
  const leaving = members.length > 0 ? switchAway : []
  for (const repo of leaving) {
    // Why uncounted: the result describes the task turning on; each failure toasts by project.
    await runOp(
      () => actions.deactivateSpotlight(repo.id, { quiet: true, projectName: repo.displayName }),
      spotlightDeactivateFailedTitle(repo.displayName)
    )
  }

  let succeeded = held.length
  for (const member of members) {
    if (held.includes(member)) {
      continue
    }
    const { repo, worktree } = member
    const ok = await runOp(
      () =>
        actions.activateSpotlight(repo.id, worktree.id, {
          quiet: true,
          projectName: repo.displayName
        }),
      spotlightActivateFailedTitle(repo.displayName)
    )
    succeeded += ok ? 1 : 0
  }
  return { mode: 'on', total: members.length, succeeded }
}

/** One toast for the whole batch; each failure already showed its own, so a full miss stays quiet. */
export function notifyTaskSpotlightBatch(taskKey: string, result: TaskSpotlightBatchResult): void {
  const { mode, total, succeeded } = result
  if (succeeded === 0) {
    return
  }
  const on = mode === 'on'
  if (succeeded === total) {
    toast.success(
      on
        ? translate(
            'auto.components.sidebar.TaskSpotlightButton.allOn',
            'Spotlight on for {{task}}',
            {
              task: taskKey
            }
          )
        : translate(
            'auto.components.sidebar.TaskSpotlightButton.allOff',
            'Spotlight off for {{task}}',
            { task: taskKey }
          )
    )
    return
  }
  // Why "projects" is always right here: a partial result needs at least two targets.
  toast.warning(
    on
      ? translate(
          'auto.components.sidebar.TaskSpotlightButton.partialOn',
          'Spotlight on for {{succeeded}} of {{total}} projects',
          { succeeded, total }
        )
      : translate(
          'auto.components.sidebar.TaskSpotlightButton.partialOff',
          'Spotlight off for {{succeeded}} of {{total}} projects',
          { succeeded, total }
        )
  )
}
