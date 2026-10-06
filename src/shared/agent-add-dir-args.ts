import type { TuiAgent } from './tui-agent'
import { quoteStartupArg, type AgentStartupShell } from './tui-agent-startup-shell'

/** Agents whose interactive CLI accepts `--add-dir` (Claude Code and Codex). */
const ADD_DIR_AGENTS: ReadonlySet<TuiAgent> = new Set(['claude', 'codex'])

export function agentSupportsAddDir(agent: TuiAgent | null | undefined): boolean {
  return agent != null && ADD_DIR_AGENTS.has(agent)
}

/**
 * One `--add-dir=<path>` per directory, quoted so the args tokenizer reads each back as a single
 * token. Why the `=` form: Claude's `--add-dir` is variadic, so a spaced value would let it
 * swallow the positional prompt that follows the args.
 */
export function buildAddDirAgentArgs(
  directories: readonly string[],
  shell: AgentStartupShell
): string {
  return directories
    .filter((directory) => directory.trim() !== '')
    .map((directory) => quoteStartupArg(`--add-dir=${directory}`, shell))
    .join(' ')
}

/** Prepends launch-only args so they sit before any `--` terminator in the configured args. */
export function withLeadingAgentArgs(agentArgs: string, leadingArgs: string): string {
  if (!leadingArgs.trim()) {
    return agentArgs
  }
  return agentArgs.trim() ? `${leadingArgs} ${agentArgs}` : leadingArgs
}
