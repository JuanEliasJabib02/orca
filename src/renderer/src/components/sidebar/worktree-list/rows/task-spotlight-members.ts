import type { Repo } from '../../../../../../shared/repo-types'
import { isFolderRepo } from '../../../../../../shared/repo-kind'
import type { SpotlightRepoState } from '../../../../../../shared/spotlight'
import type { Worktree } from '../../../../../../shared/worktree/types'
import { canHoldSpotlight } from '../../WorktreeCardSpotlightControls'
import type { TaskSectionWorktree } from '../grouping/row-types'

/** One project's stake in a task: the worktree a task-wide Spotlight would put on that project's root. */
export type TaskSpotlightMember = {
  repo: Repo
  /** The most recently active eligible worktree of the task in this repo. */
  worktree: Worktree
  /** Every eligible worktree of the task in this repo; holding any of them counts as "on". */
  taskWorktreeIds: readonly string[]
}

export type TaskSpotlightMembers = {
  eligible: TaskSpotlightMember[]
  /** Projects with a task worktree that only the project's Spotlight setting keeps out. */
  spotlightOffRepos: Repo[]
}

/** True when only the repo's Spotlight toggle, not its kind, host or worktree role, rules it out. */
function isBlockedOnlyByToggle(worktree: Worktree, repo: Repo): boolean {
  return (
    repo.spotlightTestingEnabled !== true &&
    canHoldSpotlight(worktree, { ...repo, spotlightTestingEnabled: true }, isFolderRepo(repo))
  )
}

export function resolveTaskSpotlightMembers(
  taskWorktrees: readonly TaskSectionWorktree[],
  worktreesByRepo: Readonly<Record<string, readonly Worktree[] | undefined>>,
  repos: readonly Repo[]
): TaskSpotlightMembers {
  const repoById = new Map(repos.map((repo) => [repo.id, repo]))
  const eligibleByRepoId = new Map<string, { repo: Repo; worktrees: Worktree[] }>()
  const spotlightOffById = new Map<string, Repo>()

  for (const { worktreeId, repoId } of taskWorktrees) {
    const repo = repoById.get(repoId)
    const worktree = worktreesByRepo[repoId]?.find((entry) => entry.id === worktreeId)
    if (!repo || !worktree) {
      continue
    }
    if (canHoldSpotlight(worktree, repo, isFolderRepo(repo))) {
      const entry = eligibleByRepoId.get(repoId)
      if (entry) {
        entry.worktrees.push(worktree)
      } else {
        eligibleByRepoId.set(repoId, { repo, worktrees: [worktree] })
      }
    } else if (isBlockedOnlyByToggle(worktree, repo)) {
      spotlightOffById.set(repoId, repo)
    }
  }

  const eligible: TaskSpotlightMember[] = []
  for (const { repo, worktrees } of eligibleByRepoId.values()) {
    // Why strict >: on a tie the first worktree listed in the task wins, so the pick is stable.
    const worktree = worktrees.reduce((best, entry) =>
      entry.lastActivityAt > best.lastActivityAt ? entry : best
    )
    eligible.push({ repo, worktree, taskWorktreeIds: worktrees.map((entry) => entry.id) })
  }
  return { eligible, spotlightOffRepos: [...spotlightOffById.values()] }
}

export type SpotlightHolders = Readonly<
  Record<string, Pick<SpotlightRepoState, 'holderWorktreeId'> | undefined>
>

export function isTaskSpotlightHeld(
  member: TaskSpotlightMember,
  spotlightByRepo: SpotlightHolders | undefined
): boolean {
  const holderId = spotlightByRepo?.[member.repo.id]?.holderWorktreeId
  return holderId !== undefined && member.taskWorktreeIds.includes(holderId)
}

/** Lit when every eligible project's Spotlight already holds one of the task's worktrees. */
export function isTaskSpotlightLit(
  eligible: readonly TaskSpotlightMember[],
  spotlightByRepo: SpotlightHolders | undefined
): boolean {
  return (
    eligible.length > 0 && eligible.every((member) => isTaskSpotlightHeld(member, spotlightByRepo))
  )
}
