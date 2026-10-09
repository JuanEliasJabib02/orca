// Test-only: what a POSIX PTY host that reads process groups answers for the Spotlight tests' fake
// PTY, derived from its name mocks: children or a non-shell in front are a job, a shell is the shell.
// Also what an older host answers, with the process table main then reads itself.
import type { ProcessTableRow } from '../../shared/process-table-snapshot'
import { isShellProcess } from '../../shared/shell-process-detection'
import type { HostProcessInspection } from '../../shared/terminal-process-inspection'
import type { PtyProcessInspection } from '../providers/pty-process-inspection'

type NameMockedPty = {
  hasChildProcesses: (id: string) => Promise<boolean>
  getForegroundProcess: (id: string) => Promise<string | null>
}

export async function inspectFakeSpotlightPty(
  fake: NameMockedPty,
  id: string
): Promise<PtyProcessInspection> {
  if (await fake.hasChildProcesses(id)) {
    return { foregroundProcess: null, hasChildProcesses: true, foregroundGroup: 'job' }
  }
  const foregroundProcess = await fake.getForegroundProcess(id)
  if (foregroundProcess === null) {
    return { foregroundProcess, hasChildProcesses: false }
  }
  const shellInFront = isShellProcess(foregroundProcess.replace(/^-/, ''))
  return {
    foregroundProcess,
    hasChildProcesses: false,
    foregroundGroup: shellInFront ? 'shell' : 'job'
  }
}

/** The field case: a `sh` shim (`pnpm`) runs the server, so the foreground's name is a shell's. */
export const SHELL_SCRIPT_RUNNING: PtyProcessInspection = {
  foregroundProcess: 'sh',
  hasChildProcesses: false,
  foregroundGroup: 'job'
}

/** What a daemon that predates `foregroundGroup` answers at a prompt and under a `sh` shim alike. */
export const OLD_DAEMON_ANSWER: HostProcessInspection = {
  foregroundProcess: null,
  hasChildProcesses: false
}

/** The PTY's spawned pid in {@link spotlightTerminalRows}: macOS `login`, which runs zsh. */
export const SPOTLIGHT_TERMINAL_ROOT_PID = 500
const ZSH_PID = 501
const SCRIPT_PID = 600

/** The process table under the Spotlight terminal: zsh at its prompt, or running `pnpm local`
 *  through pnpm's `sh` shim in its own foreground group. */
export function spotlightTerminalRows(scriptRunning: boolean): ProcessTableRow[] {
  const tpgid = scriptRunning ? SCRIPT_PID : ZSH_PID
  const row = (pid: number, ppid: number, pgid: number, command: string): ProcessTableRow => ({
    pid,
    ppid,
    pgid,
    tpgid,
    tty: 'ttys004',
    stat: 'S',
    command
  })
  const login = SPOTLIGHT_TERMINAL_ROOT_PID
  return [
    row(login, 1, login, '/usr/bin/login -flpq juan /bin/zsh -l'),
    row(ZSH_PID, login, ZSH_PID, '-/bin/zsh -l'),
    ...(scriptRunning
      ? [
          row(SCRIPT_PID, ZSH_PID, SCRIPT_PID, '/bin/sh /Users/juan/Library/pnpm/pnpm local'),
          row(SCRIPT_PID + 1, SCRIPT_PID, SCRIPT_PID, 'next-server (v15.5.0)')
        ]
      : [])
  ]
}
