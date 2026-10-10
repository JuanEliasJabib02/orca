// uv.lock gets pnpm-lock.yaml's treatment: a Python dev server reloads on code but never installs,
// so a switch that adds a dependency must run `uv sync --frozen` before the server starts again.
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
  describeSpotlightPendingInstall,
  isSpotlightInstallPending,
  listSpotlightRootMissingInstalls,
  markSpotlightInstallIfLockfileChanged,
  markSpotlightInstallPending,
  rememberSpotlightRoot,
  takeSpotlightLaunchInstall,
  takeSpotlightLaunchLine
} from './spotlight-lockfile-install'

const REPO_ID = 'repo-uv'
const FROM = 'a'.repeat(40)
const TO = 'b'.repeat(40)
const COMMAND = 'ax-dev-back'
const UV_CHAIN = `uv sync --frozen && ${COMMAND}`
const BOTH_CHAIN = `pnpm install --frozen-lockfile && uv sync --frozen && ${COMMAND}`
const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')

/** Git that reports `changed` as the lockfiles differing, each still present in `toSha`. */
function fakeContext(changed: string[]): SpotlightGitContext & { calls: string[][] } {
  const calls: string[][] = []
  const git = vi.fn<SpotlightGitExecutor>(async (args) => {
    calls.push(args)
    const stdout = args[0] === 'diff-tree' ? changed.map((path) => `${path}\n`).join('') : 'c\n'
    return { stdout, stderr: '' }
  })
  return { git, detectConflict: async () => 'unknown', calls }
}

function mark(ctx: SpotlightGitContext, rootPath = '/repo/uv'): Promise<boolean> {
  return markSpotlightInstallIfLockfileChanged({
    repoId: REPO_ID,
    ctx,
    rootPath,
    fromSha: FROM,
    toSha: TO
  })
}

function onPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { configurable: true, value: platform })
}

afterEach(() => {
  clearSpotlightInstallPending(REPO_ID)
  rememberSpotlightRoot(REPO_ID, '/repo/uv')
  if (originalPlatform) {
    Object.defineProperty(process, 'platform', originalPlatform)
  }
})

describe('a uv.lock change', () => {
  it('flags uv once, checked in the same diff as pnpm-lock.yaml', async () => {
    const ctx = fakeContext(['uv.lock'])

    expect(await mark(ctx)).toBe(true)
    expect(ctx.calls).toEqual([
      ['diff-tree', '--name-only', FROM, TO, '--', 'pnpm-lock.yaml', 'uv.lock'],
      ['rev-parse', '--verify', '-q', `${TO}:uv.lock`]
    ])
    expect(takeSpotlightLaunchLine(REPO_ID, COMMAND, 'zsh')).toBe(UV_CHAIN)
    expect(takeSpotlightLaunchLine(REPO_ID, COMMAND, 'zsh')).toBe(COMMAND)
  })

  it('chains both installs, pnpm first, when both lockfiles changed', async () => {
    expect(await mark(fakeContext(['pnpm-lock.yaml', 'uv.lock']))).toBe(true)

    expect(takeSpotlightLaunchLine(REPO_ID, COMMAND, 'zsh')).toBe(BOTH_CHAIN)
  })

  it('flags nothing when neither lockfile changed', async () => {
    expect(await mark(fakeContext([]))).toBe(false)
    expect(isSpotlightInstallPending(REPO_ID)).toBe(false)
  })

  it('tells a server started by hand to run uv sync', async () => {
    await mark(fakeContext(['uv.lock']))

    expect(describeSpotlightPendingInstall(REPO_ID)).toBe(
      'uv.lock changed — stop the server, run "uv sync", then start it again'
    )
    markSpotlightInstallPending(REPO_ID, ['pnpm'])
    expect(describeSpotlightPendingInstall(REPO_ID)).toBe(
      'pnpm-lock.yaml and uv.lock changed — stop the server, run "pnpm install" and "uv sync", then start it again'
    )
  })

  it('hands back only what it took', () => {
    markSpotlightInstallPending(REPO_ID, ['uv'])
    const { taken } = takeSpotlightLaunchInstall(REPO_ID)

    expect(isSpotlightInstallPending(REPO_ID)).toBe(false)
    markSpotlightInstallPending(REPO_ID, taken)
    expect(takeSpotlightLaunchInstall(REPO_ID)).toEqual({ installers: ['uv'], taken: ['uv'] })
  })
})

describe('a uv root without .venv', () => {
  let root = ''

  beforeEach(() => {
    root = mkdtempSync(nodePath.join(tmpdir(), 'orca-spotlight-uv-'))
    writeFileSync(nodePath.join(root, 'uv.lock'), 'version = 1\n')
    rememberSpotlightRoot(REPO_ID, root)
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('syncs on every line until .venv exists', () => {
    expect(listSpotlightRootMissingInstalls(root)).toEqual(['uv'])
    expect(takeSpotlightLaunchLine(REPO_ID, COMMAND, 'zsh')).toBe(UV_CHAIN)
    expect(takeSpotlightLaunchLine(REPO_ID, COMMAND, 'zsh')).toBe(UV_CHAIN)

    mkdirSync(nodePath.join(root, '.venv'))
    expect(takeSpotlightLaunchLine(REPO_ID, COMMAND, 'zsh')).toBe(COMMAND)
  })

  it('installs both when the root also lacks node_modules', () => {
    writeFileSync(nodePath.join(root, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n')

    expect(listSpotlightRootMissingInstalls(root)).toEqual(['pnpm', 'uv'])
    expect(takeSpotlightLaunchLine(REPO_ID, COMMAND, 'zsh')).toBe(BOTH_CHAIN)
  })

  it('asks for nothing without a uv.lock', () => {
    rmSync(nodePath.join(root, 'uv.lock'))

    expect(listSpotlightRootMissingInstalls(root)).toEqual([])
    expect(takeSpotlightLaunchLine(REPO_ID, COMMAND, 'zsh')).toBe(COMMAND)
  })

  it('syncs once alongside a pending uv.lock change, consuming the pending one', () => {
    markSpotlightInstallPending(REPO_ID, ['uv'])

    expect(takeSpotlightLaunchInstall(REPO_ID)).toEqual({ installers: ['uv'], taken: ['uv'] })
    expect(isSpotlightInstallPending(REPO_ID)).toBe(false)
  })
})

describe('uv install chain per shell', () => {
  it('uses `; if ($?)` for Windows PowerShell 5.1, nested when both install', () => {
    onPlatform('win32')

    expect(chainSpotlightInstall(COMMAND, 'powershell.exe', ['uv'])).toBe(
      `uv sync --frozen; if ($?) { ${COMMAND} }`
    )
    expect(chainSpotlightInstall(COMMAND, 'powershell.exe', ['uv', 'pnpm'])).toBe(
      `pnpm install --frozen-lockfile; if ($?) { uv sync --frozen; if ($?) { ${COMMAND} } }`
    )
  })

  it('keeps `&&` for PowerShell 7 and off Windows', () => {
    onPlatform('win32')
    expect(chainSpotlightInstall(COMMAND, 'pwsh.exe', ['uv'])).toBe(UV_CHAIN)
    onPlatform('darwin')
    expect(chainSpotlightInstall(COMMAND, 'zsh', ['pnpm', 'uv'])).toBe(BOTH_CHAIN)
  })

  it('leaves the command alone with nothing to install', () => {
    expect(chainSpotlightInstall(COMMAND, 'zsh', [])).toBe(COMMAND)
  })
})

describe('a uv.lock change against a real repository', () => {
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

  async function flagged(fromSha: string, toSha: string): Promise<string> {
    await markSpotlightInstallIfLockfileChanged({
      repoId: REPO_ID,
      ctx: realContext,
      rootPath: root,
      fromSha,
      toSha
    })
    // Only the pending flags: the temp root has no lockfile on disk to read.
    rememberSpotlightRoot(REPO_ID, '/repo/uv')
    return takeSpotlightLaunchLine(REPO_ID, COMMAND, 'zsh')
  }

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('flags only commits whose uv.lock differs and still exists', async () => {
    root = mkdtempSync(nodePath.join(tmpdir(), 'orca-spotlight-uv-lockfile-'))
    git('init', '-q')
    git('config', 'user.name', 'Test')
    git('config', 'user.email', 'test@example.com')
    const noLockfile = commit({ 'pyproject.toml': '[project]\nname = "api"\n' })
    const lockfileAdded = commit({ 'uv.lock': 'version = 1\n' })
    const otherFileChanged = commit({ 'pyproject.toml': '[project]\nname = "api2"\n' })
    const pypdfAdded = commit({ 'uv.lock': 'version = 1\n[[package]]\nname = "pypdf"\n' })
    const bothChanged = commit({
      'uv.lock': 'version = 1\n',
      'pnpm-lock.yaml': 'lockfileVersion: 9\n'
    })
    const lockfileDeleted = commit({ 'uv.lock': null })

    expect(await flagged(noLockfile, lockfileAdded)).toBe(UV_CHAIN)
    expect(await flagged(lockfileAdded, otherFileChanged)).toBe(COMMAND)
    expect(await flagged(otherFileChanged, pypdfAdded)).toBe(UV_CHAIN)
    expect(await flagged(pypdfAdded, bothChanged)).toBe(BOTH_CHAIN)
    expect(await flagged(bothChanged, lockfileDeleted)).toBe(COMMAND)
  })
})
