import type * as pty from 'node-pty'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProcessTableRow } from '../../shared/process-table-snapshot'
import type * as SnapshotReader from '../../shared/process-table-snapshot-reader'

const { readFreshSnapshot, resolveForegroundMock } = vi.hoisted(() => ({
  readFreshSnapshot: vi.fn(),
  resolveForegroundMock: vi.fn()
}))

vi.mock('../../shared/process-table-snapshot-reader', async (importOriginal) => ({
  ...(await importOriginal<typeof SnapshotReader>()),
  getFreshShellForegroundSnapshot: readFreshSnapshot
}))
vi.mock('./agent-foreground-process', () => ({
  resolveAgentForegroundProcessWithAvailability: resolveForegroundMock,
  confirmShellForegroundProcess: vi.fn(async () => false)
}))

import { readLocalPtyForegroundGroup } from './local-pty-foreground-inspection'
import { LocalPtyProvider } from './local-pty-provider'
import { ptyProcesses, ptyShellPath } from './local-pty-provider-state'
import { inspectPtyProviderProcess } from './pty-process-inspection'

const SHELL_PID = 4242
const SCRIPT_PID = 4300
const describeOnPosix = process.platform === 'win32' ? describe.skip : describe

function registerPane(id: string, foreground: string): pty.IPty {
  const pane: pty.IPty = {
    pid: SHELL_PID,
    cols: 80,
    rows: 24,
    process: foreground,
    handleFlowControl: false,
    onData: () => ({ dispose() {} }),
    onExit: () => ({ dispose() {} }),
    resize() {},
    clear() {},
    write() {},
    kill() {},
    pause() {},
    resume() {}
  }
  ptyProcesses.set(id, pane)
  ptyShellPath.set(id, '/bin/zsh')
  return pane
}

/** Linux-shaped: node-pty spawns the shell itself. */
function rows(scriptRunning: boolean): ProcessTableRow[] {
  const foreground = scriptRunning ? SCRIPT_PID : SHELL_PID
  const shell = { pid: SHELL_PID, ppid: 1, pgid: SHELL_PID, tpgid: foreground }
  return scriptRunning
    ? [
        { ...shell, stat: 'Ss', command: '/bin/zsh' },
        {
          pid: SCRIPT_PID,
          ppid: SHELL_PID,
          pgid: SCRIPT_PID,
          tpgid: SCRIPT_PID,
          stat: 'S+',
          command: '/bin/sh /home/juan/.local/share/pnpm/pnpm local'
        }
      ]
    : [{ ...shell, stat: 'Ss+', command: '/bin/zsh' }]
}

beforeEach(() => {
  readFreshSnapshot.mockReset()
  resolveForegroundMock.mockReset()
  resolveForegroundMock.mockResolvedValue({ available: true, processName: null })
})

afterEach(() => {
  ptyProcesses.clear()
  ptyShellPath.clear()
})

describeOnPosix('local PTY foreground group', () => {
  const provider = new LocalPtyProvider()

  it('reads a sh script in front as a job, whose name the name check calls a shell', async () => {
    registerPane('pty-script', 'sh')
    readFreshSnapshot.mockResolvedValue(rows(true))

    expect(
      await inspectPtyProviderProcess(provider, 'pty-script', { observeForegroundGroup: true })
    ).toMatchObject({ foregroundGroup: 'job' })
  })

  it('reads the shell at its prompt as the shell', async () => {
    registerPane('pty-idle', 'zsh')
    readFreshSnapshot.mockResolvedValue(rows(false))

    expect(
      await inspectPtyProviderProcess(provider, 'pty-idle', { observeForegroundGroup: true })
    ).toMatchObject({ foregroundGroup: 'shell', childProcessEvidence: 'no-children' })
  })

  it('only pays for the process-table read when asked', async () => {
    registerPane('pty-idle', 'zsh')

    const inspection = await inspectPtyProviderProcess(provider, 'pty-idle')

    expect(inspection).not.toHaveProperty('foregroundGroup')
    expect(readFreshSnapshot).not.toHaveBeenCalled()
  })

  it('answers nothing for an unknown pane, an unreadable table, or a replaced pane', async () => {
    expect(await readLocalPtyForegroundGroup('pty-absent')).toBeNull()

    registerPane('pty-unreadable', 'zsh')
    readFreshSnapshot.mockRejectedValue(new Error('ps failed'))
    expect(await readLocalPtyForegroundGroup('pty-unreadable')).toBeNull()

    registerPane('pty-swapped', 'zsh')
    readFreshSnapshot.mockImplementation(async () => {
      registerPane('pty-swapped', 'zsh')
      return rows(false)
    })
    expect(await readLocalPtyForegroundGroup('pty-swapped')).toBeNull()
  })
})
