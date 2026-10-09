import { execFile, execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import nodePath from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SpotlightGitContext, SpotlightGitExecutor } from '../../shared/spotlight-sync-core'
import {
  chainSpotlightInstall,
  clearSpotlightInstallPending,
  isSpotlightInstallPending,
  isSpotlightRootMissingDependencies,
  isWindowsPowerShell51,
  markSpotlightInstallIfLockfileChanged,
  markSpotlightInstallPending,
  rememberSpotlightRoot,
  takeSpotlightLaunchInstall,
  takeSpotlightLaunchLine
} from './spotlight-lockfile-install'

const REPO_ID = 'repo-1'
const FROM = 'a'.repeat(40)
const TO = 'b'.repeat(40)
const ROOT = '/repo/root'
const AND_CHAIN = 'pnpm install --frozen-lockfile && pnpm dev'
const POWERSHELL_51_CHAIN = 'pnpm install --frozen-lockfile; if ($?) { pnpm dev }'

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

describe('launch line with a pending install', () => {
  it('chains the install once per change', () => {
    markSpotlightInstallPending(REPO_ID)

    expect(takeSpotlightLaunchLine(REPO_ID, 'pnpm dev', 'zsh')).toBe(AND_CHAIN)
    expect(takeSpotlightLaunchLine(REPO_ID, 'pnpm dev', 'zsh')).toBe('pnpm dev')
  })

  it('is dropped by clear', () => {
    markSpotlightInstallPending(REPO_ID)
    clearSpotlightInstallPending(REPO_ID)

    expect(takeSpotlightLaunchLine(REPO_ID, 'pnpm dev', 'zsh')).toBe('pnpm dev')
  })

  it('is tracked per repo', () => {
    markSpotlightInstallPending('repo-2')

    expect(takeSpotlightLaunchLine(REPO_ID, 'pnpm dev', null)).toBe('pnpm dev')
    expect(takeSpotlightLaunchLine('repo-2', 'pnpm dev', null)).toBe(AND_CHAIN)
  })
})

describe('a root that was never installed', () => {
  let root = ''

  beforeEach(() => {
    root = mkdtempSync(nodePath.join(tmpdir(), 'orca-spotlight-deps-'))
    writeFileSync(nodePath.join(root, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n')
    rememberSpotlightRoot(REPO_ID, root)
  })

  afterEach(() => {
    // Back to a root with nothing to install, for the other tests of this repo id.
    rememberSpotlightRoot(REPO_ID, ROOT)
    rmSync(root, { recursive: true, force: true })
  })

  it('is missing dependencies only with a pnpm lockfile and no node_modules directory', () => {
    expect(isSpotlightRootMissingDependencies(root)).toBe(true)

    mkdirSync(nodePath.join(root, 'node_modules'))
    expect(isSpotlightRootMissingDependencies(root)).toBe(false)

    const noLockfile = mkdtempSync(nodePath.join(tmpdir(), 'orca-spotlight-deps-'))
    try {
      expect(isSpotlightRootMissingDependencies(noLockfile)).toBe(false)
    } finally {
      rmSync(noLockfile, { recursive: true, force: true })
    }
    expect(isSpotlightRootMissingDependencies(nodePath.join(root, 'gone'))).toBe(false)
  })

  it('chains the install on every line until node_modules exists', () => {
    expect(takeSpotlightLaunchLine(REPO_ID, 'pnpm dev', 'zsh')).toBe(AND_CHAIN)
    expect(takeSpotlightLaunchLine(REPO_ID, 'pnpm dev', 'zsh')).toBe(AND_CHAIN)

    mkdirSync(nodePath.join(root, 'node_modules'))
    expect(takeSpotlightLaunchLine(REPO_ID, 'pnpm dev', 'zsh')).toBe('pnpm dev')
  })

  it('chains it once alongside a pending lockfile change, consuming the pending one', () => {
    markSpotlightInstallPending(REPO_ID)

    expect(takeSpotlightLaunchInstall(REPO_ID)).toEqual({ install: true, pendingTaken: true })
    expect(isSpotlightInstallPending(REPO_ID)).toBe(false)
    expect(takeSpotlightLaunchInstall(REPO_ID)).toEqual({ install: true, pendingTaken: false })
  })

  it('uses the Windows PowerShell 5.1 form for that shell', () => {
    const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')
    Object.defineProperty(process, 'platform', { configurable: true, value: 'win32' })
    try {
      expect(takeSpotlightLaunchLine(REPO_ID, 'pnpm dev', 'powershell.exe')).toBe(
        POWERSHELL_51_CHAIN
      )
    } finally {
      if (originalPlatform) {
        Object.defineProperty(process, 'platform', originalPlatform)
      }
    }
  })

  it('is never checked for a repo whose root Orca has not seen', () => {
    expect(takeSpotlightLaunchLine('repo-unseen', 'pnpm dev', 'zsh')).toBe('pnpm dev')
  })

  it('is learned from the root every activation checks for a lockfile change', async () => {
    rememberSpotlightRoot(REPO_ID, ROOT)
    expect(takeSpotlightLaunchLine(REPO_ID, 'pnpm dev', 'zsh')).toBe('pnpm dev')

    await markSpotlightInstallIfLockfileChanged({
      repoId: REPO_ID,
      ctx: fakeContext({ diff: '' }),
      rootPath: root,
      fromSha: null,
      toSha: TO
    })

    expect(takeSpotlightLaunchLine(REPO_ID, 'pnpm dev', 'zsh')).toBe(AND_CHAIN)
  })
})

describe('install chain per shell', () => {
  const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')

  function onPlatform(platform: NodeJS.Platform): void {
    Object.defineProperty(process, 'platform', { configurable: true, value: platform })
  }

  afterEach(() => {
    if (originalPlatform) {
      Object.defineProperty(process, 'platform', originalPlatform)
    }
  })

  it('uses `; if ($?)` for Windows PowerShell 5.1, which has no `&&`', () => {
    onPlatform('win32')

    expect(chainSpotlightInstall('pnpm dev', 'powershell.exe')).toBe(POWERSHELL_51_CHAIN)
    expect(
      chainSpotlightInstall(
        'pnpm dev',
        'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'
      )
    ).toBe(POWERSHELL_51_CHAIN)
    expect(isWindowsPowerShell51('PowerShell')).toBe(true)
  })

  it('keeps `&&` for PowerShell 7, cmd, Git Bash and an unknown shell on Windows', () => {
    onPlatform('win32')

    for (const shell of ['pwsh.exe', 'cmd.exe', 'bash.exe', null]) {
      expect(chainSpotlightInstall('pnpm dev', shell)).toBe(AND_CHAIN)
    }
  })

  it('keeps `&&` off Windows, whatever the shell is called', () => {
    onPlatform('darwin')

    for (const shell of ['zsh', 'bash', 'fish', 'powershell']) {
      expect(chainSpotlightInstall('pnpm dev', shell)).toBe(AND_CHAIN)
    }
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
