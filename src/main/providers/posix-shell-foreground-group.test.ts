import { describe, expect, it } from 'vitest'
import type { ProcessTableRow } from '../../shared/process-table-snapshot'
import { resolvePtyForegroundGroup } from './posix-shell-foreground-group'

const TTY = 'ttys004'

function row(
  pid: number,
  ppid: number,
  pgid: number,
  tpgid: number,
  command: string,
  stat = 'S'
): ProcessTableRow {
  return { pid, ppid, pgid, tpgid, tty: TTY, stat, command }
}

// macOS: the PTY spawns `login`, which runs the login shell in its own process group.
const LOGIN = 500
const ZSH = 501

function macTerminal(foregroundPgid: number, ...children: ProcessTableRow[]): ProcessTableRow[] {
  return [
    row(LOGIN, 1, LOGIN, foregroundPgid, '/usr/bin/login -flpq juan /bin/zsh -l'),
    row(ZSH, LOGIN, ZSH, foregroundPgid, '-/bin/zsh -l', foregroundPgid === ZSH ? 'S+' : 'S'),
    ...children
  ]
}

describe('resolvePtyForegroundGroup', () => {
  it('reads the login shell at its prompt as the shell, past the login wrapper', () => {
    expect(resolvePtyForegroundGroup(macTerminal(ZSH), LOGIN)).toBe('shell')
  })

  it('reads the pnpm sh shim running a server as a job, though its name is a shell', () => {
    const rows = macTerminal(
      600,
      row(600, ZSH, 600, 600, '/bin/sh /Users/juan/Library/pnpm/pnpm local', 'S+'),
      row(601, 600, 600, 600, 'node /Users/juan/Library/pnpm/pnpm.cjs local', 'S+'),
      row(602, 601, 600, 600, 'next-server (v15.5.0)', 'S+')
    )

    expect(resolvePtyForegroundGroup(rows, LOGIN)).toBe('job')
  })

  it('reads a bash script under a bash shell as a job (Linux, no wrapper)', () => {
    const rows = [
      row(700, 1, 700, 710, '-bash'),
      row(710, 700, 710, 710, 'bash /usr/local/bin/ax-dev-back', 'S+'),
      row(711, 710, 710, 710, 'uv run uvicorn app:app', 'S+')
    ]

    expect(resolvePtyForegroundGroup(rows, 700)).toBe('job')
    expect(resolvePtyForegroundGroup([row(700, 1, 700, 700, '/bin/bash', 'Ss+')], 700)).toBe(
      'shell'
    )
  })

  it('reads a stopped job as a job even with the prompt back', () => {
    const rows = macTerminal(ZSH, row(800, ZSH, 800, ZSH, 'node server.js', 'T'))

    expect(resolvePtyForegroundGroup(rows, LOGIN)).toBe('job')
  })

  it('leaves a backgrounded job out of the foreground decision', () => {
    const rows = macTerminal(ZSH, row(900, ZSH, 900, ZSH, 'sleep 100', 'S'))

    expect(resolvePtyForegroundGroup(rows, LOGIN)).toBe('shell')
  })

  it('cannot tell without the PTY root, a shell, or the group columns', () => {
    expect(resolvePtyForegroundGroup(macTerminal(ZSH), 4242)).toBeNull()
    expect(
      resolvePtyForegroundGroup([row(LOGIN, 1, LOGIN, LOGIN, '/usr/bin/login -flpq juan')], LOGIN)
    ).toBeNull()
    const withoutGroups: ProcessTableRow[] = [
      { pid: 700, ppid: 1, stat: 'S+', command: '/bin/zsh' }
    ]
    expect(resolvePtyForegroundGroup(withoutGroups, 700)).toBeNull()
    expect(resolvePtyForegroundGroup([row(700, 1, 700, -1, '/bin/zsh')], 700)).toBeNull()
  })
})
