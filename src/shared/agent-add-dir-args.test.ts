import { describe, expect, it } from 'vitest'
import {
  agentSupportsAddDir,
  buildAddDirAgentArgs,
  withLeadingAgentArgs
} from './agent-add-dir-args'
import { tokenizeStartupCommand } from './tui-agent-startup-shell'
import { buildAgentStartupPlan } from './tui-agent-startup'

describe('agentSupportsAddDir', () => {
  it('covers Claude Code and Codex only', () => {
    expect(agentSupportsAddDir('claude')).toBe(true)
    expect(agentSupportsAddDir('codex')).toBe(true)
    expect(agentSupportsAddDir('gemini')).toBe(false)
    expect(agentSupportsAddDir(null)).toBe(false)
  })
})

describe('buildAddDirAgentArgs', () => {
  it('emits one `--add-dir=<path>` token per directory', () => {
    const args = buildAddDirAgentArgs(['/work/backend', '/work/admin'], 'posix')
    expect(tokenizeStartupCommand(args, 'posix')).toMatchObject({
      ok: true,
      tokens: ['--add-dir=/work/backend', '--add-dir=/work/admin']
    })
  })

  it('keeps a path with spaces inside a single token', () => {
    const posix = buildAddDirAgentArgs(['/Users/me/My Repos/api'], 'posix')
    expect(tokenizeStartupCommand(posix, 'posix')).toMatchObject({
      ok: true,
      tokens: ['--add-dir=/Users/me/My Repos/api']
    })
    const powershell = buildAddDirAgentArgs(["C:\\Users\\me\\it's here"], 'powershell')
    expect(tokenizeStartupCommand(powershell, 'powershell')).toMatchObject({
      ok: true,
      tokens: ["--add-dir=C:\\Users\\me\\it's here"]
    })
  })

  it('drops blank paths', () => {
    expect(buildAddDirAgentArgs(['', '  '], 'posix')).toBe('')
  })
})

describe('withLeadingAgentArgs', () => {
  it('puts the launch-only args before the configured ones', () => {
    expect(withLeadingAgentArgs('--model sonnet -- extra', "'--add-dir=/a'")).toBe(
      "'--add-dir=/a' --model sonnet -- extra"
    )
  })

  it('returns either side alone when the other is empty', () => {
    expect(withLeadingAgentArgs('', "'--add-dir=/a'")).toBe("'--add-dir=/a'")
    expect(withLeadingAgentArgs('--model sonnet', '')).toBe('--model sonnet')
  })
})

describe('add-dir args in a launch command', () => {
  it('lands before configured args and the prompt, which stays the last argument', () => {
    const plan = buildAgentStartupPlan({
      agent: 'claude',
      prompt: 'fix the login flow',
      cmdOverrides: {},
      agentArgs: withLeadingAgentArgs(
        '--dangerously-skip-permissions',
        buildAddDirAgentArgs(['/work/my api', '/work/admin'], 'posix')
      ),
      platform: 'linux'
    })

    expect(plan?.launchCommand).toBe(
      "claude '--add-dir=/work/my api' '--add-dir=/work/admin' '--dangerously-skip-permissions' 'fix the login flow'"
    )
  })

  it('never leaves a bare `--add-dir` that a variadic parser could extend into the prompt', () => {
    const plan = buildAgentStartupPlan({
      agent: 'claude',
      prompt: 'ship it',
      cmdOverrides: {},
      agentArgs: buildAddDirAgentArgs(['/work/admin'], 'posix'),
      platform: 'linux'
    })
    const tokens = tokenizeStartupCommand(plan?.launchCommand ?? '', 'posix')
    expect(tokens).toMatchObject({
      ok: true,
      tokens: ['claude', '--add-dir=/work/admin', 'ship it']
    })
  })
})
