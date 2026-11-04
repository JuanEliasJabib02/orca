// Spotlight turns: agents light their task's Spotlight from the CLI and queue for shared projects.

/** Main asks the renderer, which owns task grouping and the server autostart. */
export type SpotlightAgentTaskRequest =
  | { requestId: string; op: 'resolve'; worktreeId: string }
  /** Light the task of `worktreeId` in `repoIds` only (the projects its turn holds). */
  | { requestId: string; op: 'light'; worktreeId: string; repoIds: string[] }

export type SpotlightAgentTaskMember = {
  repoId: string
  repoName: string
  /** The worktree the task's Spotlight puts on this project's root. */
  worktreeId: string
  /** Every worktree of the task in this project; holding any of them counts as lit. */
  taskWorktreeIds: string[]
}

export type SpotlightAgentTaskResolution = {
  taskKey: string
  members: SpotlightAgentTaskMember[]
  /** Projects of the task left out because their Spotlight setting is off. */
  skippedRepoNames: string[]
}

export type SpotlightAgentLightResult = { repoId: string; ok: boolean; message?: string }

export type SpotlightAgentTaskReply =
  | { requestId: string; op: 'resolve'; resolution: SpotlightAgentTaskResolution }
  | { requestId: string; op: 'light'; results: SpotlightAgentLightResult[] }
  | { requestId: string; error: string }

/** One project of a turn as `orca spotlight on` reports it. */
export type SpotlightAgentServer = {
  repoId: string
  repoName: string
  /** The task's worktree holds this project's Spotlight. */
  lit: boolean
  /** Why lighting failed, or why the root couldn't take the task. */
  error?: string
  /** First listening port of the root, preferring the configured one. */
  port: number | null
  url: string | null
  listening: boolean
  server: 'running' | 'stopped' | 'unknown'
  logPath: string
}

/**
 * Who stands between a pane and its turn. Without `reason` it holds or waits for one of its
 * projects; `lane` = same space, `cap` = every slot taken. Lane and cap blockers name the
 * holder's projects.
 */
export type SpotlightAgentBlocker = {
  taskKey: string
  repoNames: string[]
  holding: boolean
  reason?: 'lane' | 'cap'
}

export type SpotlightAgentOnResult =
  | {
      status: 'on'
      taskKey: string
      servers: SpotlightAgentServer[]
      /** Projects the task has but can't light (setting off, or held by another task's turn). */
      skippedRepoNames: string[]
      /** True when every lit project's server listens. */
      ready: boolean
      /** Set when the turn holds only a test slot: the task has no project with a Spotlight. */
      note?: string
    }
  | {
      status: 'waiting'
      taskKey: string
      /** 1 = next in line for these projects. */
      position: number
      blockers: SpotlightAgentBlocker[]
    }

export type SpotlightAgentOffResult = {
  /** The task whose turn this pane gave back; null when it held none. */
  releasedTaskKey: string | null
  wasWaiting: boolean
  /** Tasks that got their turn because of this release. */
  nextTaskKeys: string[]
}

/** Why a pane's agent stopped mid-turn: it ran out of usage limit, or failed otherwise. */
export type SpotlightAgentPauseReason = 'limit' | 'error'

export type SpotlightAgentTurnRow = {
  taskKey: string
  repoNames: string[]
  panes: number
  grantedAt: number
  /** The task's panes in the order they asked; the last one asked last. */
  paneKeys?: string[]
  /** The space the turn was taken in. */
  laneKey?: string
  /** The newest hook activity of any of its panes, or its newest request. */
  lastActivityAt?: number
  /** Continuar is resuming one of its panes. */
  resuming?: true
}

export type SpotlightAgentWaitingRow = {
  taskKey: string
  repoNames: string[]
  since: number
  /** The task's first pane in line. */
  paneKey?: string
  laneKey?: string
}

/** A pane whose agent stopped mid-turn: it keeps its place in line but claims nothing. */
export type SpotlightAgentPausedRow = {
  paneKey: string
  taskKey: string
  repoNames: string[]
  laneKey?: string
  since: number
  reason: SpotlightAgentPauseReason
  pausedAt: number
  /** Continuar is resuming it right now. */
  resuming?: true
  /** Automatic resumes in a row since its turn last ended normally. */
  autoResumes?: number
}

/** Where the asking pane stands (`orca spotlight status` from an Orca terminal). */
export type SpotlightAgentMine =
  | { kind: 'holding'; taskKey: string }
  | { kind: 'waiting'; taskKey: string; position: number; blockers: SpotlightAgentBlocker[] }
  | {
      kind: 'paused'
      taskKey: string
      position: number
      reason: SpotlightAgentPauseReason
      pausedAt: number
    }
  | { kind: 'none' }

/** The queue as `orca spotlight status` prints it and the footer monitor draws it. */
export type SpotlightAgentStatus = {
  /** Most tasks testing at once on this machine; absent from older hosts. */
  cap?: number
  turns: SpotlightAgentTurnRow[]
  waiting: SpotlightAgentWaitingRow[]
  /** One row per paused pane, in line order; absent from older hosts. */
  paused?: SpotlightAgentPausedRow[]
  /** Every project whose Spotlight is on, and the workspace holding it. */
  lit: { repoName: string; holder: string; turnTaskKey: string | null }[]
  /** Only when the caller named its pane. */
  mine?: SpotlightAgentMine
}
