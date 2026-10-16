import type {
  SpotlightAgentBlocker,
  SpotlightAgentOffResult,
  SpotlightAgentOnResult,
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

function describeBlocker(blocker: SpotlightAgentBlocker): string {
  const repos = blocker.repoNames.join(', ')
  return blocker.holding
    ? `${blocker.taskKey} is testing ${repos}`
    : `${blocker.taskKey} is ahead of you for ${repos}`
}

export function formatSpotlightOn(result: SpotlightAgentOnResult): string {
  if (result.status === 'waiting') {
    return [
      `Waiting for the Spotlight for ${result.taskKey}: ${result.blockers.map(describeBlocker).join('; ')}.`,
      `You are #${result.position} in line. Your place is kept: run \`orca spotlight on\` again to keep waiting.`
    ].join('\n')
  }
  const width = Math.max(0, ...result.servers.map((server) => server.repoName.length))
  const lines = [`Spotlight on for ${result.taskKey}.`]
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

export function formatSpotlightStatus(status: SpotlightAgentStatus): string {
  const lines: string[] = []
  lines.push(status.turns.length > 0 ? 'Testing:' : 'Testing: nobody')
  for (const turn of status.turns) {
    const agents = turn.panes === 1 ? '1 agent' : `${turn.panes} agents`
    lines.push(
      `  ${turn.taskKey}  ${turn.repoNames.join(', ')}  (${agents}, since ${minutesAgo(turn.grantedAt)})`
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
  lines.push(status.lit.length > 0 ? 'Spotlight on:' : 'Spotlight on: no project')
  for (const entry of status.lit) {
    const turn = entry.turnTaskKey ? `turn of ${entry.turnTaskKey}` : 'no turn, free to take'
    lines.push(`  ${entry.repoName}  holds ${entry.holder}  (${turn})`)
  }
  return lines.join('\n')
}
