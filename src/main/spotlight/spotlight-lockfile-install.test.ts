import { execFile, execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import nodePath from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SpotlightGitContext, SpotlightGitExecutor } from '../../shared/spotlight-sync-core'
import {
  clearSpotlightInstallPending,
  isSpotlightInstallPending,
  markSpotlightInstallIfLockfileChanged,
  markSpotlightInstallPending,
  SPOTLIGHT_INSTALL_PREFIX,
  takeSpotlightInstallPrefix
} from './spotlight-lockfile-install'

const REPO_ID = 'repo-1'
const FROM = 'a'.repeat(40)
const TO = 'b'.repeat(40)
const ROOT = '/repo/root'

/** Answers the two reads the check makes: the lockfile diff and the lockfile blob in `toSha`. */
function fakeContext(answers: {
  diff: string | Error
  blob?: string | Error
}): SpotlightGitContext & { calls: string[][] } {
  const calls: string[][] = []
  const git = vi.fn<SpotlightGitExecutor>(async (args) => {
    calls.push(args)
    const answer = args[0] === 'diff-tree' ? answers.diff : (answers.blob ?? '')
    if (answer instanceof Error) {
      throw answer
    }
    return { stdout: answer, stderr: '' }
  })
  return { git, detectConflict: async () => 'unknown', calls }
}

function mark(ctx: SpotlightGitContext, fromSha: string | null = FROM): Promise<boolean> {
  return markSpotlightInstallIfLockfileChanged({
    repoId: REPO_ID,
    ctx,
    rootPath: ROOT,
    fromSha,
    toSha: TO
  })
}

afterEach(() => {
  clearSpotlightInstallPending(REPO_ID)
})

describe('markSpotlightInstallIfLockfileChanged', () => {
  it('flags the repo when the lockfile changed and exists after', async () => {
    const ctx = fakeContext({ diff: 'pnpm-lock.yaml\n', blob: 'c'.repeat(40) })

    expect(await mark(ctx)).toBe(true)
    expect(ctx.calls).toEqual([
      ['diff-tree', '--name-only', FROM, TO, '--', 'pnpm-lock.yaml'],
      ['rev-parse', '--verify', '-q', `${TO}:pnpm-lock.yaml`]
    ])
    expect(isSpotlightInstallPending(REPO_ID)).toBe(true)
  })

  it('stops after one read when the lockfile is unchanged', async () => {
    const ctx = fakeContext({ diff: '' })

    expect(await mark(ctx)).toBe(false)
    expect(ctx.calls).toHaveLength(1)
    expect(isSpotlightInstallPending(REPO_ID)).toBe(false)
  })

  it('does not flag a lockfile the new snapshot deleted', async () => {
    const ctx = fakeContext({ diff: 'pnpm-lock.yaml', blob: '' })

    expect(await mark(ctx)).toBe(false)
    expect(isSpotlightInstallPending(REPO_ID)).toBe(false)
  })

  it('does not flag when either git read fails', async () => {
    expect(await mark(fakeContext({ diff: new Error('fatal: bad object') }))).toBe(false)
    expect(
      await mark(fakeContext({ diff: 'pnpm-lock.yaml', blob: new Error('fatal: not a git repo') }))
    ).toBe(false)
    expect(isSpotlightInstallPending(REPO_ID)).toBe(false)
  })

  it('skips git when there is no earlier commit or nothing moved', async () => {
    const ctx = fakeContext({ diff: 'pnpm-lock.yaml', blob: 'c'.repeat(40) })

    expect(await mark(ctx, null)).toBe(false)
    expect(await mark(ctx, TO)).toBe(false)
    expect(ctx.calls).toEqual([])
  })
})

describe('install prefix', () => {
  it('is handed out once per change', () => {
    markSpotlightInstallPending(REPO_ID)

    expect(SPOTLIGHT_INSTALL_PREFIX).toBe('pnpm install --frozen-lockfile && ')
    expect(takeSpotlightInstallPrefix(REPO_ID)).toBe(SPOTLIGHT_INSTALL_PREFIX)
    expect(takeSpotlightInstallPrefix(REPO_ID)).toBe('')
  })

  it('is dropped by clear', () => {
    markSpotlightInstallPending(REPO_ID)
    clearSpotlightInstallPending(REPO_ID)

    expect(takeSpotlightInstallPrefix(REPO_ID)).toBe('')
  })

  it('is tracked per repo', () => {
    markSpotlightInstallPending('repo-2')

    expect(takeSpotlightInstallPrefix(REPO_ID)).toBe('')
    expect(takeSpotlightInstallPrefix('repo-2')).toBe(SPOTLIGHT_INSTALL_PREFIX)
  })
})

describe('markSpotlightInstallIfLockfileChanged against a real repository', () => {
  const execFileAsync = promisify(execFile)
  const realContext: SpotlightGitContext = {
    git: async (args, cwd) => execFileAsync('git', args, { cwd, encoding: 'utf-8' }),
    detectConflict: async () => 'unknown'
  }
  let root = ''

  function git(...args: string[]): string {
    return execFileSync('git', args, { cwd: root, stdio: 'pipe', encoding: 'utf-8' }).trim()
  }

  function commit(files: Record<string, string | null>): string {
    for (const [file, content] of Object.entries(files)) {
      if (content === null) {
        git('rm', '-q', file)
      } else {
        writeFileSync(nodePath.join(root, file), content)
        git('add', file)
      }
    }
    git('commit', '-q', '-m', 'change')
    return git('rev-parse', 'HEAD')
  }

  async function changed(fromSha: string, toSha: string): Promise<boolean> {
    const flagged = await markSpotlightInstallIfLockfileChanged({
      repoId: REPO_ID,
      ctx: realContext,
      rootPath: root,
      fromSha,
      toSha
    })
    clearSpotlightInstallPending(REPO_ID)
    return flagged
  }

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('flags only commits whose pnpm-lock.yaml differs and still exists', async () => {
    root = mkdtempSync(nodePath.join(tmpdir(), 'orca-spotlight-lockfile-'))
    git('init', '-q')
    git('config', 'user.name', 'Test')
    git('config', 'user.email', 'test@example.com')
    const noLockfile = commit({ 'package.json': '{}\n' })
    const lockfileAdded = commit({ 'pnpm-lock.yaml': 'lockfileVersion: 9\n' })
    const otherFileChanged = commit({ 'package.json': '{"name":"app"}\n' })
    const lockfileChanged = commit({ 'pnpm-lock.yaml': 'lockfileVersion: 9\nfoo: 1\n' })
    const lockfileDeleted = commit({ 'pnpm-lock.yaml': null })

    expect(await changed(noLockfile, lockfileAdded)).toBe(true)
    expect(await changed(lockfileAdded, otherFileChanged)).toBe(false)
    expect(await changed(otherFileChanged, lockfileChanged)).toBe(true)
    expect(await changed(lockfileChanged, lockfileDeleted)).toBe(false)
    expect(await changed(lockfileDeleted, 'f'.repeat(40))).toBe(false)
  })
})
