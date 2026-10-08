// Test-only: what a POSIX PTY host that reads process groups answers for the Spotlight tests' fake
// PTY, derived from its name mocks: children or a non-shell in front are a job, a shell is the shell.
import { isShellProcess } from '../../shared/shell-process-detection'
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
