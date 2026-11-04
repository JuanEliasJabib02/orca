import type {
  SpotlightAgentBlocker,
  SpotlightAgentMine,
  SpotlightAgentOffResult,
  SpotlightAgentOnResult,
  SpotlightAgentPauseReason,
  SpotlightAgentServer,
  SpotlightAgentStatus
} from '../shared/spotlight-agent-turn'

function serverState(server: SpotlightAgentServer): string {
  if (!server.lit) {
    return `not lit${server.error ? `: ${server.error}` : ''}`
  }
  if (server.listening) {
    return 'listening'
  }
  return server.server === 'running' ? 'starting (port not open yet)' : 'no server running'
}

// Why these words: the tester rules name them, so agents know why they wait.
const BLOCKER_REASON_LABELS = { lane: ' (same space)', cap: ' (limit reached)' } as const

function describeBlocker(blocker: SpotlightAgentBlocker): string {
  const repos = blocker.repoNames.join(', ')
  const label = blocker.reason ? BLOCKER_REASON_LABELS[blocker.reason] : ''
  if (blocker.holding) {
    return `${blocker.taskKey} is testing${repos ? ` ${repos}` : ''}${label}`
  }
  return `${blocker.taskKey} is ahead of you${repos ? ` for ${repos}` : ''}${label}`
}

export function formatSpotlightOn(result: SpotlightAgentOnResult): string {
  if (result.status === 'waiting') {
    return [
      `Waiting for the Spotlight for ${result.taskKey}: ${result.blockers.map(describeBlocker).join('; ')}.`,
      `You are #${result.position} in line. Your place is kept: run \`orca spotlight on\` again to keep waiting.`
    ].join('\n')
  }
  const width = Math.max(0, ...result.servers.map((server) => server.repoName.length))
  // Why: a slot-only turn lights nothing, so it isn't a Spotlight being on.
  const lines = result.note
    ? [`Your test turn for ${result.taskKey} is on.`, result.note]
    : [`Spotlight on for ${result.taskKey}.`]
  for (const server of result.servers) {
    lines.push(`  ${server.repoName.padEnd(width)}  ${server.url ?? '-'}  ${serverState(server)}`)
    lines.push(`  ${' '.repeat(width)}  log: ${server.logPath}`)
  }
  if (result.skippedRepoNames.length > 0) {
    lines.push(`Not included: ${result.skippedRepoNames.join(', ')}.`)
  }
  if (!result.ready) {
    lines.push(
      'Not every server is listening yet. Read its log, or run `orca spotlight on` again to keep waiting.'
    )
  }
  lines.push('When you finish testing, run `orca spotlight off` so the next task can test.')
  return lines.join('\n')
}

export function formatSpotlightOff(result: SpotlightAgentOffResult): string {
  if (result.releasedTaskKey === null) {
    return result.wasWaiting
      ? 'Left the line for the Spotlight.'
      : 'This terminal held no Spotlight turn.'
  }
  const next =
    result.nextTaskKeys.length > 0
      ? ` ${result.nextTaskKeys.join(', ')} ${result.nextTaskKeys.length === 1 ? 'is' : 'are'} testing next.`
      : ' The servers keep running until another task takes the projects.'
  return `Gave back the Spotlight turn of ${result.releasedTaskKey}.${next}`
}

function minutesAgo(timestamp: number): string {
  const minutes = Math.max(0, Math.round((Date.now() - timestamp) / 60_000))
  return minutes === 0 ? 'just now' : `${minutes} min ago`
}

function pauseReason(reason: SpotlightAgentPauseReason): string {
  return reason === 'limit' ? 'out of usage limit' : 'stopped on an error'
}

function describeMine(mine: SpotlightAgentMine): string {
  switch (mine.kind) {
    case 'holding':
      return `This terminal: testing ${mine.taskKey}.`
    case 'waiting': {
      const behind = mine.blockers.map(describeBlocker).join('; ')
      return `This terminal: #${mine.position} in line for ${mine.taskKey}${behind ? `: ${behind}` : ''}.`
    }
    case 'paused':
      return `This terminal: paused (${pauseReason(mine.reason)}), #${mine.position} in line for ${mine.taskKey}. Run \`orca spotlight on\` to take your place back.`
    case 'none':
      return 'This terminal: no turn. Run `orca spotlight on` before testing.'
  }
}

export function formatSpotlightStatus(status: SpotlightAgentStatus): string {
  const lines: string[] = []
  if (status.cap !== undefined) {
    lines.push(`Limit: ${status.cap} ${status.cap === 1 ? 'task' : 'tasks'} at a time`)
  }
  lines.push(status.turns.length > 0 ? 'Testing:' : 'Testing: nobody')
  for (const turn of status.turns) {
    const agents = turn.panes === 1 ? '1 agent' : `${turn.panes} agents`
    const active =
      turn.lastActivityAt === undefined ? '' : `, last active ${minutesAgo(turn.lastActivityAt)}`
    lines.push(
      `  ${turn.taskKey}  ${turn.repoNames.join(', ')}  (${agents}, since ${minutesAgo(turn.grantedAt)}${active})`
    )
  }
  if (status.waiting.length > 0) {
    lines.push('Waiting:')
    for (const waiter of status.waiting) {
      lines.push(
        `  ${waiter.taskKey}  ${waiter.repoNames.join(', ')}  (since ${minutesAgo(waiter.since)})`
      )
    }
  }
  if (status.paused && status.paused.length > 0) {
    lines.push('Paused:')
    for (const row of status.paused) {
      const resuming = row.resuming ? ', resuming' : ''
      lines.push(
        `  ${row.taskKey}  ${row.repoNames.join(', ') || '-'}  (${pauseReason(row.reason)}, paused ${minutesAgo(row.pausedAt)}${resuming})`
      )
    }
  }
  if (status.mine) {
    lines.push(describeMine(status.mine))
  }
  lines.push(status.lit.length > 0 ? 'Spotlight on:' : 'Spotlight on: no project')
  for (const entry of status.lit) {
    const turn = entry.turnTaskKey ? `turn of ${entry.turnTaskKey}` : 'no turn, free to take'
    lines.push(`  ${entry.repoName}  holds ${entry.holder}  (${turn})`)
  }
  return lines.join('\n')
}
