import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import type { SpotlightOpResult } from '../../../../../../shared/spotlight'
import {
  isTaskSpotlightHeld,
  isTaskSpotlightLit,
  type SpotlightHolders,
  type TaskSpotlightMember
} from './task-spotlight-members'

export type TaskSpotlightActions = {
  activateSpotlight: (
    repoId: string,
    worktreeId: string,
    opts?: { quiet?: boolean }
  ) => Promise<SpotlightOpResult>
  deactivateSpotlight: (repoId: string, opts?: { quiet?: boolean }) => Promise<SpotlightOpResult>
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
 *  Sequential, and a failing project never stops the rest. */
export async function runTaskSpotlightBatch(args: {
  members: readonly TaskSpotlightMember[]
  spotlightByRepo: SpotlightHolders | undefined
  actions: TaskSpotlightActions
}): Promise<TaskSpotlightBatchResult> {
  const { members, spotlightByRepo, actions } = args
  const held = members.filter((member) => isTaskSpotlightHeld(member, spotlightByRepo))

  if (isTaskSpotlightLit(members, spotlightByRepo)) {
    let succeeded = 0
    for (const { repo } of held) {
      const ok = await runOp(
        () => actions.deactivateSpotlight(repo.id, { quiet: true }),
        translate('auto.store.slices.spotlight.deactivateFailed', 'Failed to turn off Spotlight')
      )
      succeeded += ok ? 1 : 0
    }
    return { mode: 'off', total: held.length, succeeded }
  }

  let succeeded = held.length
  for (const member of members) {
    if (held.includes(member)) {
      continue
    }
    const ok = await runOp(
      () => actions.activateSpotlight(member.repo.id, member.worktree.id, { quiet: true }),
      translate('auto.store.slices.spotlight.activateFailed', 'Failed to start Spotlight')
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
