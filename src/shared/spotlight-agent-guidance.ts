import type { Repo } from './repo-types'
import type { TuiAgent } from './tui-agent'

/** Single-line so it survives startup-command tokenizing/quoting; no quotes,
 *  backslashes, `$`, or backticks so it can be embedded in the launch command
 *  without shell surprises. */
export const SPOTLIGHT_AGENT_GUIDANCE =
  'Orca Spotlight is active for this project: a dev server runs at the repository ROOT (not this workspace), and its live output is mirrored to the file .orca/spotlight.log at that root (the absolute path is in the ORCA_SPOTLIGHT_LOG env var; the root path in ORCA_SPOTLIGHT_ROOT). To read the server or build logs from any workspace, read that file. Check .orca/spotlight-state.json at the root for which workspace currently holds the Spotlight before assuming a log error belongs to this workspace.'

/** Only the plain `claude` CLI takes --append-system-prompt; other agents get
 *  the guidance via the follow-up, agent-agnostic mechanism (see PR). */
function agentAcceptsSpotlightSystemPrompt(agent: TuiAgent): boolean {
  return agent === 'claude'
}

/** Appends `--append-system-prompt "<guidance>"` to the agent CLI args when this
 *  is a Spotlight-enabled local repo and the agent supports it. Returns the args
 *  unchanged otherwise — a no-op for every non-Spotlight / non-Claude launch. */
export function withSpotlightAgentGuidance(
  agentArgs: string | null | undefined,
  agent: TuiAgent,
  repo: Pick<Repo, 'spotlightTestingEnabled' | 'connectionId'> | null | undefined
): string | null | undefined {
  if (
    !repo ||
    repo.spotlightTestingEnabled !== true ||
    repo.connectionId?.trim() ||
    !agentAcceptsSpotlightSystemPrompt(agent)
  ) {
    return agentArgs
  }
  const injected = `--append-system-prompt "${SPOTLIGHT_AGENT_GUIDANCE}"`
  return agentArgs?.trim() ? `${agentArgs} ${injected}` : injected
}
