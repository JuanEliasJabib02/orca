import type { Repo } from '../../../shared/repo-types'
import type { AgentStartupPlanInputs } from '../../../shared/agent-launch/startup/agent-startup-plan-inputs'
import { withSpotlightAgentGuidance } from '../../../shared/spotlight-agent-guidance'

export type NewTabAgentLaunchArgs = {
  /** What this window's own launch builds its startup command from. */
  startupInputs: AgentStartupPlanInputs
  /** What a host-started launch gets; undefined lets the host resolve its own defaults. */
  hostAgentArgs: string | null | undefined
}

/**
 * When Spotlight is active, tell the agent (Claude) where the mirrored dev-server log lives so it
 * uses it without the user having to explain the setup. No-op for non-Spotlight repos and
 * non-Claude agents.
 */
export function withNewTabSpotlightGuidance(
  startupInputs: AgentStartupPlanInputs,
  agentArgs: string | null | undefined,
  repo: Repo | null | undefined
): NewTabAgentLaunchArgs {
  const guidedAgentArgs = withSpotlightAgentGuidance(
    startupInputs.agentArgs,
    startupInputs.agent,
    repo
  )
  if (guidedAgentArgs === startupInputs.agentArgs) {
    return { startupInputs, hostAgentArgs: agentArgs }
  }
  // Why: host launches resolve their own default args, so send ours only when the guidance changed them.
  return {
    startupInputs: { ...startupInputs, agentArgs: guidedAgentArgs ?? null },
    hostAgentArgs: guidedAgentArgs
  }
}
