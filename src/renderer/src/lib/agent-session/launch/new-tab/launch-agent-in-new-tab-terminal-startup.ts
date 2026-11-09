import type { Repo } from '../../../../../../shared/repo-types'
import { resolveAgentStartupPlanInputs } from '../../../../../../shared/agent-launch/startup/agent-startup-plan-inputs'
import { planLaunchAgentStartupPrompt } from '@/lib/agent-session/launch/prompt/launch-agent-startup-prompt-plan'
import { withNewTabSpotlightGuidance } from '@/lib/new-tab-agent-launch-args'

type NewTabStartupInputs = Parameters<typeof resolveAgentStartupPlanInputs>[0]
type NewTabStartupPrompt = Omit<Parameters<typeof planLaunchAgentStartupPrompt>[0], 'base'>

/**
 * Plans a new tab's terminal startup with Spotlight's dev-server log guidance folded into the
 * agent args; `hostAgentArgs` is what a host-started launch of the same tab must receive.
 */
export function planNewTabTerminalStartup(
  inputs: NewTabStartupInputs,
  prompt: NewTabStartupPrompt,
  repo: Repo | null | undefined
): ReturnType<typeof planLaunchAgentStartupPrompt> & {
  hostAgentArgs: string | null | undefined
} {
  const { startupInputs, hostAgentArgs } = withNewTabSpotlightGuidance(
    resolveAgentStartupPlanInputs(inputs),
    inputs.agentArgs,
    repo
  )
  return { ...planLaunchAgentStartupPrompt({ ...prompt, base: startupInputs }), hostAgentArgs }
}
