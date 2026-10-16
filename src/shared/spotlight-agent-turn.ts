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

export type SpotlightAgentBlocker = { taskKey: string; repoNames: string[]; holding: boolean }

export type SpotlightAgentOnResult =
  | {
      status: 'on'
      taskKey: string
      servers: SpotlightAgentServer[]
      /** Projects the task has but can't light (setting off, or held by another task's turn). */
      skippedRepoNames: string[]
      /** True when every lit project's server listens. */
      ready: boolean
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

export type SpotlightAgentStatus = {
  turns: { taskKey: string; repoNames: string[]; panes: number; grantedAt: number }[]
  waiting: { taskKey: string; repoNames: string[]; since: number }[]
  /** Every project whose Spotlight is on, and the workspace holding it. */
  lit: { repoName: string; holder: string; turnTaskKey: string | null }[]
}
