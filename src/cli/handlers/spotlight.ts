import type {
  SpotlightAgentOffResult,
  SpotlightAgentOnResult,
  SpotlightAgentStatus
} from '../../shared/spotlight-agent-turn'
import type { CommandHandler } from '../dispatch'
import { getOptionalPositiveIntegerFlag } from '../flags'
import { printResult } from '../format'
import { RuntimeClientError } from '../runtime/types'
import { formatSpotlightOff, formatSpotlightOn, formatSpotlightStatus } from '../spotlight-format'

// Why: under an agent shell's default 2-minute command cap; `on` is rerun to keep waiting.
export const DEFAULT_SPOTLIGHT_ON_TIMEOUT_MS = 100_000
// Why: the host resolves the task through the window (up to 10s) before the wait starts.
const SPOTLIGHT_ON_CLIENT_GRACE_MS = 20_000

function requireTerminalEnv(name: 'ORCA_PANE_KEY' | 'ORCA_WORKTREE_ID'): string {
  const value = process.env[name]?.trim()
  if (!value) {
    throw new RuntimeClientError(
      'invalid_environment',
      'orca spotlight must run inside the Orca terminal of the workspace you want to test.'
    )
  }
  return value
}

export const SPOTLIGHT_HANDLERS: Record<string, CommandHandler> = {
  'spotlight on': async ({ flags, client, json }) => {
    const timeoutMs =
      getOptionalPositiveIntegerFlag(flags, 'timeout-ms') ?? DEFAULT_SPOTLIGHT_ON_TIMEOUT_MS
    const result = await client.call<SpotlightAgentOnResult>(
      'spotlight.on',
      {
        worktree: requireTerminalEnv('ORCA_WORKTREE_ID'),
        paneKey: requireTerminalEnv('ORCA_PANE_KEY'),
        timeoutMs
      },
      { timeoutMs: timeoutMs + SPOTLIGHT_ON_CLIENT_GRACE_MS }
    )
    printResult(result, json, formatSpotlightOn)
    if (result.result.status === 'waiting') {
      // Why: `orca spotlight on && <tests>` must not run the tests before the turn comes.
      process.exitCode = 1
    }
  },
  'spotlight off': async ({ client, json }) => {
    const result = await client.call<SpotlightAgentOffResult>('spotlight.off', {
      paneKey: requireTerminalEnv('ORCA_PANE_KEY')
    })
    printResult(result, json, formatSpotlightOff)
  },
  'spotlight status': async ({ client, json }) => {
    const result = await client.call<SpotlightAgentStatus>('spotlight.status')
    printResult(result, json, formatSpotlightStatus)
  }
}
