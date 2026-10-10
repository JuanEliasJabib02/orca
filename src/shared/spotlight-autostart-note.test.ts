import { describe, expect, it } from 'vitest'
import {
  describeSpotlightAutostartNote,
  parseSpotlightAutostartNote,
  type SpotlightAutostartNote
} from './spotlight-autostart-note'

describe('parseSpotlightAutostartNote', () => {
  it('keeps every note kind the renderer reports', () => {
    const notes: SpotlightAutostartNote[] = [
      { kind: 'no-command', env: 'dev' },
      { kind: 'needs-variant', asked: true },
      { kind: 'needs-variant', asked: false },
      { kind: 'plan-failed' },
      { kind: 'no-main-worktree' },
      { kind: 'prepare-failed', refused: true },
      { kind: 'queued' },
      { kind: 'queued-started' },
      { kind: 'queued-dropped', reason: 'timeout' },
      { kind: 'start-failed', reason: 'not-active' }
    ]

    expect(notes.map(parseSpotlightAutostartNote)).toEqual(notes)
  })

  it('drops fields it does not know, so the renderer never picks the text', () => {
    expect(parseSpotlightAutostartNote({ kind: 'queued', line: 'rm -rf /' })).toEqual({
      kind: 'queued'
    })
  })

  it('rejects unknown kinds, environments and reasons', () => {
    expect(parseSpotlightAutostartNote(null)).toBeNull()
    expect(parseSpotlightAutostartNote('queued')).toBeNull()
    expect(parseSpotlightAutostartNote({ kind: 'started' })).toBeNull()
    expect(parseSpotlightAutostartNote({ kind: 'no-command', env: 'staging' })).toBeNull()
    expect(parseSpotlightAutostartNote({ kind: 'queued-dropped', reason: 'bored' })).toBeNull()
    expect(parseSpotlightAutostartNote({ kind: 'start-failed' })).toBeNull()
  })
})

describe('describeSpotlightAutostartNote', () => {
  it('names the environment without a command', () => {
    expect(describeSpotlightAutostartNote({ kind: 'no-command', env: 'local' }, undefined)).toBe(
      'Server not started — no command for Local'
    )
  })

  it('quotes the queued line, and marks it started like a typed one', () => {
    const line = 'pnpm install --frozen-lockfile && pnpm local --port 3004'

    expect(describeSpotlightAutostartNote({ kind: 'queued' }, line)).toBe(
      `Server queued for a new Spotlight terminal ("${line}")`
    )
    expect(describeSpotlightAutostartNote({ kind: 'queued-started' }, line)).toBe(
      `Server started by Orca ("${line}")`
    )
  })

  it('gives the concrete reason for a drop or a failure', () => {
    expect(
      describeSpotlightAutostartNote({ kind: 'queued-dropped', reason: 'spotlight-off' }, 'x')
    ).toBe('Queued server line dropped — Spotlight turned off first')
    expect(
      describeSpotlightAutostartNote({ kind: 'start-failed', reason: 'no-terminal' }, undefined)
    ).toBe('Server not started — no Spotlight terminal was registered')
    expect(
      describeSpotlightAutostartNote({ kind: 'prepare-failed', refused: true }, undefined)
    ).toBe('Server not started — Spotlight was no longer active when its line was prepared')
  })
})
