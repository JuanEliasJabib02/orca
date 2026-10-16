import { useAppStore } from '@/store'
import { getAllWorktreesFromState } from '@/store/selectors'
import { getTaskKeysForAllWorktrees } from '@/components/sidebar/worktree-list/grouping/worktree-task-keys'
import {
  notifyTaskSpotlightBatch,
  runTaskSpotlightBatch,
  type TaskSpotlightActions
} from '@/components/sidebar/worktree-list/rows/task-spotlight-batch'
import {
  isTaskSpotlightLit,
  resolveTaskSpotlightMembers,
  type TaskSpotlightMember
} from '@/components/sidebar/worktree-list/rows/task-spotlight-members'
import type { Repo } from '../../../shared/repo-types'
import type {
  SpotlightAgentLightResult,
  SpotlightAgentTaskReply,
  SpotlightAgentTaskRequest
} from '../../../shared/spotlight-agent-turn'
import type { Worktree } from '../../../shared/worktree/types'

export type AgentSpotlightTask = {
  taskKey: string
  members: TaskSpotlightMember[]
  spotlightOffRepos: Repo[]
}

/** The task of `worktreeId` as the Group by → Task header sees it, across every worktree (not only
 *  the visible ones). The caller's own worktree wins its project, since that's the one it tests. */
export function resolveAgentSpotlightTask(args: {
  worktreeId: string
  allWorktrees: readonly Worktree[]
  worktreesByRepo: Readonly<Record<string, readonly Worktree[] | undefined>>
  repos: readonly Repo[]
}): AgentSpotlightTask | { error: string } {
  const { worktreeId, allWorktrees, worktreesByRepo, repos } = args
  const caller = allWorktrees.find((worktree) => worktree.id === worktreeId)
  if (!caller) {
    return { error: 'Orca does not know this workspace. Run the command from an Orca workspace.' }
  }
  const taskKeys = getTaskKeysForAllWorktrees(allWorktrees)
  const taskKey = taskKeys.getTaskKey(caller)
  if (!taskKey) {
    return {
      error:
        'This workspace is not part of a task (project roots and archived workspaces never are).'
    }
  }
  const taskWorktrees = allWorktrees
    .filter((worktree) => taskKeys.getTaskKey(worktree) === taskKey)
    .map((worktree) => ({ worktreeId: worktree.id, repoId: worktree.repoId }))
  const { eligible, spotlightOffRepos } = resolveTaskSpotlightMembers(
    taskWorktrees,
    worktreesByRepo,
    repos
  )
  const members = eligible.map((member) =>
    member.taskWorktreeIds.includes(caller.id) ? { ...member, worktree: caller } : member
  )
  return { taskKey, members, spotlightOffRepos }
}

function resolveFromStore(worktreeId: string): AgentSpotlightTask {
  const state = useAppStore.getState()
  const task = resolveAgentSpotlightTask({
    worktreeId,
    allWorktrees: getAllWorktreesFromState(state),
    worktreesByRepo: state.worktreesByRepo,
    repos: state.repos
  })
  if ('error' in task) {
    throw new Error(task.error)
  }
  return task
}

/** Lights the task like its header button, minus the toggle-off and the switch-away: an agent's turn
 *  only ever turns its own projects on. Projects already lit for the task are left alone. */
async function lightAgentSpotlightTask(
  worktreeId: string,
  repoIds: readonly string[]
): Promise<SpotlightAgentLightResult[]> {
  const task = resolveFromStore(worktreeId)
  const wanted = new Set(repoIds)
  const members = task.members.filter((member) => wanted.has(member.repo.id))
  const state = useAppStore.getState()
  if (members.length === 0 || isTaskSpotlightLit(members, state.spotlightByRepo)) {
    return members.map((member) => ({ repoId: member.repo.id, ok: true }))
  }
  const failures = new Map<string, string>()
  const actions: TaskSpotlightActions = {
    activateSpotlight: async (repoId, memberWorktreeId, opts) => {
      try {
        const result = await state.activateSpotlight(repoId, memberWorktreeId, opts)
        if (!result.ok) {
          failures.set(repoId, result.error.message)
        }
        return result
      } catch (error) {
        failures.set(repoId, error instanceof Error ? error.message : String(error))
        throw error
      }
    },
    deactivateSpotlight: state.deactivateSpotlight
  }
  const batch = await runTaskSpotlightBatch({
    members,
    spotlightByRepo: state.spotlightByRepo,
    actions
  })
  notifyTaskSpotlightBatch(task.taskKey, batch)
  return members.map((member) => {
    const message = failures.get(member.repo.id)
    return message === undefined
      ? { repoId: member.repo.id, ok: true }
      : { repoId: member.repo.id, ok: false, message }
  })
}

async function answer(request: SpotlightAgentTaskRequest): Promise<SpotlightAgentTaskReply> {
  const { requestId } = request
  try {
    if (request.op === 'resolve') {
      const task = resolveFromStore(request.worktreeId)
      return {
        requestId,
        op: 'resolve',
        resolution: {
          taskKey: task.taskKey,
          members: task.members.map((member) => ({
            repoId: member.repo.id,
            repoName: member.repo.displayName,
            worktreeId: member.worktree.id,
            taskWorktreeIds: [...member.taskWorktreeIds]
          })),
          skippedRepoNames: task.spotlightOffRepos.map((repo) => repo.displayName)
        }
      }
    }
    const results = await lightAgentSpotlightTask(request.worktreeId, request.repoIds)
    return { requestId, op: 'light', results }
  } catch (error) {
    return { requestId, error: error instanceof Error ? error.message : String(error) }
  }
}

export function registerSpotlightAgentTaskRequests(unsubs: (() => void)[]): void {
  unsubs.push(
    window.api.spotlight.onAgentTaskRequest((request) => {
      void answer(request).then((reply) => window.api.spotlight.replyAgentTaskRequest(reply))
    })
  )
}
