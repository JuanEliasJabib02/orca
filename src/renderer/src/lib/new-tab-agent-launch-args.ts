import type { AppState } from '@/store/types'
import type { Repo } from '../../../shared/repo-types'
import type { TuiAgent } from '../../../shared/tui-agent'
import { resolveTuiAgentLaunchArgs } from '../../../shared/tui-agent-launch-defaults'
import { withSpotlightAgentGuidance } from '../../../shared/spotlight-agent-guidance'

export type NewTabAgentLaunchArgs = {
  /** What this window's own launch passes to the agent CLI. */
  effectiveAgentArgs: string | null | undefined
  /** What a host-started launch gets; undefined lets the host resolve its own defaults. */
  hostAgentArgs: string | null | undefined
}

/**
 * The agent CLI args for a new-tab launch. When Spotlight is active, tell the agent (Claude)
 * where the mirrored dev-server log lives so it uses it without the user having to explain the
 * setup. No-op for non-Spotlight repos and non-Claude agents.
 */
export function resolveNewTabAgentLaunchArgs(
  agent: TuiAgent,
  agentArgs: string | null | undefined,
  settings: AppState['settings'],
  repo: Repo | null | undefined
): NewTabAgentLaunchArgs {
  const baseAgentArgs =
    agentArgs !== undefined
      ? agentArgs
      : resolveTuiAgentLaunchArgs(agent, settings?.agentDefaultArgs)
  const effectiveAgentArgs = withSpotlightAgentGuidance(baseAgentArgs, agent, repo)
  // Why: host launches resolve their own default args, so send ours only when the guidance changed them.
  const hostAgentArgs = effectiveAgentArgs === baseAgentArgs ? agentArgs : effectiveAgentArgs
  return { effectiveAgentArgs, hostAgentArgs }
}
