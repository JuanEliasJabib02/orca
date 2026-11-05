// The test queue as `orca spotlight status` and the footer monitor read it.
import path from 'node:path'
import type { SpotlightRepoState } from '../../shared/spotlight'
import type {
  SpotlightAgentBlocker,
  SpotlightAgentMine,
  SpotlightAgentStatus,
  SpotlightAgentTurnRow,
  SpotlightAgentWaitingRow
} from '../../shared/spotlight-agent-turn'
import type {
  SpotlightTurnBlocker,
  SpotlightTurnPosition,
  SpotlightTurnQueueSnapshot
} from './spotlight-agent-turn-queue'

type RepoNames = (repoIds: readonly string[]) => string[]

export type SpotlightBoardSources = {
  snapshot: SpotlightTurnQueueSnapshot
  /** Most tasks testing at once; not finite when nothing caps them. */
  cap: number
  lit: readonly SpotlightRepoState[]
  repoNames: RepoNames
  /** When the pane last asked for its turn. */
  requestedAt: (paneKey: string) => number | undefined
  /** The pane's newest hook activity. */
  activityAt: (paneKey: string) => number | undefined
  isResuming: (paneKey: string) => boolean
  autoResumes: (paneKey: string) => number
  /** The repo the pane works in; names a row whose task has no Spotlight project. */
  paneRepoName?: (paneKey: string) => string | undefined
}

export function toAgentBlockers(
  blockers: readonly SpotlightTurnBlocker[],
  repoNames: RepoNames
): SpotlightAgentBlocker[] {
  return blockers.map((blocker) => ({
    taskKey: blocker.taskKey,
    repoNames: repoNames(blocker.repoIds),
    holding: blocker.holding,
    ...(blocker.reason ? { reason: blocker.reason } : {})
  }))
}

/** `repoId::/path/to/worktree` → `worktree`. */
function worktreeFolderName(worktreeId: string): string {
  const separator = worktreeId.indexOf('::')
  return path.basename(separator === -1 ? worktreeId : worktreeId.slice(separator + 2))
}

function latest(times: readonly (number | undefined)[]): number | undefined {
  const known = times.filter((time): time is number => time !== undefined)
  return known.length > 0 ? Math.max(...known) : undefined
}

/** A slot-only row has no projects, so it is named by the repos its panes work in. */
function rowRepoNames(
  sources: SpotlightBoardSources,
  repoIds: readonly string[],
  paneKeys: readonly string[]
): string[] {
  if (repoIds.length > 0) {
    return sources.repoNames(repoIds)
  }
  return [...new Set(paneKeys.flatMap((paneKey) => sources.paneRepoName?.(paneKey) ?? []))]
}

function turnRows(sources: SpotlightBoardSources): SpotlightAgentTurnRow[] {
  return sources.snapshot.turns.map((turn) => {
    // Why the order: Continuar resumes the pane that asked last.
    const paneKeys = [...turn.paneKeys].sort(
      (a, b) => (sources.requestedAt(a) ?? 0) - (sources.requestedAt(b) ?? 0)
    )
    const lastActivityAt = latest(
      paneKeys.flatMap((paneKey) => [sources.activityAt(paneKey), sources.requestedAt(paneKey)])
    )
    const resuming = paneKeys.some((paneKey) => sources.isResuming(paneKey))
    return {
      taskKey: turn.taskKey,
      repoNames: rowRepoNames(sources, turn.repoIds, paneKeys),
      panes: turn.paneKeys.length,
      grantedAt: turn.grantedAt,
      paneKeys,
      ...(turn.laneKey === undefined ? {} : { laneKey: turn.laneKey }),
      ...(lastActivityAt === undefined ? {} : { lastActivityAt }),
      ...(resuming ? { resuming: true as const } : {})
    }
  })
}

/** One row per waiting task: its panes are granted together. */
function waitingRows(sources: SpotlightBoardSources): SpotlightAgentWaitingRow[] {
  const listed = new Set<string>()
  return sources.snapshot.waiting.flatMap((waiter) => {
    if (listed.has(waiter.taskKey)) {
      return []
    }
    listed.add(waiter.taskKey)
    return [
      {
        taskKey: waiter.taskKey,
        repoNames: rowRepoNames(sources, waiter.repoIds, [waiter.paneKey]),
        since: waiter.since,
        paneKey: waiter.paneKey,
        ...(waiter.laneKey === undefined ? {} : { laneKey: waiter.laneKey })
      }
    ]
  })
}

export function buildSpotlightBoard(sources: SpotlightBoardSources): SpotlightAgentStatus {
  const { snapshot, repoNames } = sources
  return {
    ...(Number.isFinite(sources.cap) ? { cap: sources.cap } : {}),
    turns: turnRows(sources),
    waiting: waitingRows(sources),
    // Why per pane: each paused pane is resumed on its own.
    paused: snapshot.paused.map((entry) => {
      const autoResumes = sources.autoResumes(entry.paneKey)
      return {
        paneKey: entry.paneKey,
        taskKey: entry.taskKey,
        repoNames: rowRepoNames(sources, entry.repoIds, [entry.paneKey]),
        ...(entry.laneKey === undefined ? {} : { laneKey: entry.laneKey }),
        since: entry.since,
        reason: entry.reason,
        pausedAt: entry.pausedAt,
        ...(sources.isResuming(entry.paneKey) ? { resuming: true as const } : {}),
        ...(autoResumes > 0 ? { autoResumes } : {})
      }
    }),
    lit: sources.lit.map((state) => ({
      repoName: repoNames([state.repoId])[0],
      holder: worktreeFolderName(state.holderWorktreeId),
      turnTaskKey:
        snapshot.turns.find((turn) => turn.repoIds.includes(state.repoId))?.taskKey ?? null
    }))
  }
}

/** Where `paneKey` stands; `kind` comes first so a line-based reader finds it. */
export function describeMine(
  paneKey: string,
  position: SpotlightTurnPosition | null,
  sources: Pick<SpotlightBoardSources, 'snapshot' | 'repoNames'>
): SpotlightAgentMine {
  if (position?.kind === 'holding') {
    return { kind: 'holding', taskKey: position.turn.taskKey }
  }
  const { waiting, paused } = sources.snapshot
  const entry = [...waiting, ...paused].find((row) => row.paneKey === paneKey)
  if (!position || !entry) {
    return { kind: 'none' }
  }
  if (position.paused) {
    return {
      kind: 'paused',
      taskKey: entry.taskKey,
      position: position.position,
      reason: position.paused.reason,
      pausedAt: position.paused.pausedAt
    }
  }
  return {
    kind: 'waiting',
    taskKey: entry.taskKey,
    position: position.position,
    blockers: toAgentBlockers(position.blockers, sources.repoNames)
  }
}
