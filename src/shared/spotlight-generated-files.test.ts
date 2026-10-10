// Field case (2026-10-10): turning Spotlight off in reset and action-sport-club failed with
// root-diverged. The only change in both roots was next-env.d.ts, which `next dev` (Next 16)
// rewrites on start. Generated files never count as divergence; any other change still does.
import { execFile, execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { isSpotlightGeneratedFile } from './spotlight-generated-files'
import { readRootStatus } from './spotlight-sync-primitives'
import {
  activateSpotlightCore,
  deactivateSpotlightCore,
  inspectSpotlightRefsCore,
  syncSpotlightCore,
  type SpotlightGitContext
} from './spotlight-sync-core'

const execFileAsync = promisify(execFile)

const ctx: SpotlightGitContext = {
  git: async (args, cwd, opts) =>
    execFileAsync('git', args, {
      cwd,
      encoding: 'utf-8',
      env: opts?.env ? { ...process.env, ...opts.env } : process.env
    }),
  detectConflict: async () => 'unknown'
}

const NEXT_ENV = '/// <reference types="next" />\nimport "./.next/types/routes.d.ts";\n'
// What `next dev` (Next 16) writes over it on start.
const NEXT_ENV_DEV = '/// <reference types="next" />\nimport "./.next/dev/types/routes.d.ts";\n'

function run(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, stdio: 'pipe', encoding: 'utf-8' }).trim()
}

function write(dir: string, relPath: string, content: string): void {
  const filePath = path.join(dir, relPath)
  mkdirSync(path.dirname(filePath), { recursive: true })
  writeFileSync(filePath, content)
}

function read(dir: string, relPath: string): string {
  return readFileSync(path.join(dir, relPath), 'utf-8')
}

describe('isSpotlightGeneratedFile', () => {
  it('matches next-env.d.ts at the root and in monorepo apps', () => {
    expect(isSpotlightGeneratedFile('next-env.d.ts')).toBe(true)
    expect(isSpotlightGeneratedFile('apps/web/next-env.d.ts')).toBe(true)
  })

  it('matches nothing else', () => {
    for (const other of ['next-env.ts', 'mynext-env.d.ts', 'next-env.d.ts.bak', 'src/env.d.ts']) {
      expect(isSpotlightGeneratedFile(other)).toBe(false)
    }
  })
})

describe('a root whose only change is a generated file', () => {
  let baseDir = ''
  let rootPath = ''
  let worktreePath = ''

  beforeEach(() => {
    baseDir = mkdtempSync(path.join(tmpdir(), 'orca-spotlight-generated-'))
    rootPath = path.join(baseDir, 'root')
    worktreePath = path.join(baseDir, 'wt')
    mkdirSync(rootPath)
    run(rootPath, 'init', '-b', 'main')
    run(rootPath, 'config', 'user.name', 'Test')
    run(rootPath, 'config', 'user.email', 'test@example.com')
    write(rootPath, 'a.txt', 'a-original\n')
    write(rootPath, 'next-env.d.ts', NEXT_ENV)
    write(rootPath, 'apps/web/next-env.d.ts', NEXT_ENV)
    run(rootPath, 'add', '-A')
    run(rootPath, 'commit', '-m', 'initial')
    run(rootPath, 'worktree', 'add', worktreePath, '-b', 'feature')
  })

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true })
  })

  /** Spotlight on, then the dev server at the root rewrites `relPath`. */
  async function activateAndRunDevServer(relPath = 'next-env.d.ts'): Promise<void> {
    write(worktreePath, 'a.txt', 'wt-version\n')
    await activateSpotlightCore(ctx, rootPath, worktreePath)
    write(rootPath, relPath, NEXT_ENV_DEV)
  }

  it('turns off, restoring the file, at the root or nested', async () => {
    await activateAndRunDevServer()
    write(rootPath, 'apps/web/next-env.d.ts', NEXT_ENV_DEV)

    await deactivateSpotlightCore(ctx, rootPath)

    expect(read(rootPath, 'next-env.d.ts')).toBe(NEXT_ENV)
    expect(read(rootPath, 'apps/web/next-env.d.ts')).toBe(NEXT_ENV)
    expect(read(rootPath, 'a.txt')).toBe('a-original\n')
    expect(run(rootPath, 'symbolic-ref', '--short', 'HEAD')).toBe('main')
    expect((await inspectSpotlightRefsCore(ctx, rootPath)).snapshotSha).toBeNull()
  })

  it('syncs the next workspace change over it', async () => {
    await activateAndRunDevServer('apps/web/next-env.d.ts')
    write(worktreePath, 'a.txt', 'wt-change\n')

    const outcome = await syncSpotlightCore(ctx, rootPath, worktreePath)

    expect(outcome.skipped).toBe(false)
    expect(read(rootPath, 'a.txt')).toBe('wt-change\n')
    expect(read(rootPath, 'apps/web/next-env.d.ts')).toBe(NEXT_ENV)
  })

  it('hands the root to another workspace', async () => {
    const worktree2 = path.join(baseDir, 'wt2')
    run(rootPath, 'worktree', 'add', worktree2, '-b', 'feature-2')
    await activateAndRunDevServer()
    write(worktree2, 'a.txt', 'wt2-version\n')

    const takeover = await activateSpotlightCore(ctx, rootPath, worktree2)

    expect(takeover.alreadyActive).toBe(true)
    expect(read(rootPath, 'a.txt')).toBe('wt2-version\n')
  })

  it('reads the first status entry whole (git prints it with a leading space)', async () => {
    write(rootPath, 'next-env.d.ts', NEXT_ENV_DEV)
    expect(await readRootStatus(ctx, rootPath)).toEqual({
      trackedDirty: false,
      untrackedPaths: new Set()
    })

    write(rootPath, 'a.txt', 'edited\n')
    expect((await readRootStatus(ctx, rootPath)).trackedDirty).toBe(true)
  })

  it('still refuses when a real file changed next to it', async () => {
    const worktree2 = path.join(baseDir, 'wt2')
    run(rootPath, 'worktree', 'add', worktree2, '-b', 'feature-2')
    await activateAndRunDevServer()
    write(rootPath, 'a.txt', 'edited-directly-in-root\n')
    write(worktreePath, 'a.txt', 'wt-change\n')

    const diverged = { code: 'root-diverged' }
    await expect(deactivateSpotlightCore(ctx, rootPath)).rejects.toMatchObject(diverged)
    await expect(syncSpotlightCore(ctx, rootPath, worktreePath)).rejects.toMatchObject(diverged)
    await expect(activateSpotlightCore(ctx, rootPath, worktree2)).rejects.toMatchObject(diverged)
    expect(read(rootPath, 'a.txt')).toBe('edited-directly-in-root\n')
  })

  it('still refuses a real file renamed to a generated name', async () => {
    await activateAndRunDevServer()
    mkdirSync(path.join(rootPath, 'apps/api'), { recursive: true })
    run(rootPath, 'mv', 'a.txt', 'apps/api/next-env.d.ts')

    await expect(deactivateSpotlightCore(ctx, rootPath)).rejects.toMatchObject({
      code: 'root-diverged'
    })
  })
})

describe('a repo that does not track the generated file', () => {
  let baseDir = ''
  let rootPath = ''
  let worktreePath = ''

  beforeEach(() => {
    baseDir = mkdtempSync(path.join(tmpdir(), 'orca-spotlight-generated-untracked-'))
    rootPath = path.join(baseDir, 'root')
    worktreePath = path.join(baseDir, 'wt')
    mkdirSync(rootPath)
    run(rootPath, 'init', '-b', 'main')
    run(rootPath, 'config', 'user.name', 'Test')
    run(rootPath, 'config', 'user.email', 'test@example.com')
    write(rootPath, 'a.txt', 'a-original\n')
    run(rootPath, 'add', '-A')
    run(rootPath, 'commit', '-m', 'initial')
    run(rootPath, 'worktree', 'add', worktreePath, '-b', 'feature')
  })

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true })
  })

  it('turns off with an untracked or a staged one in the root', async () => {
    await activateSpotlightCore(ctx, rootPath, worktreePath)
    write(rootPath, 'next-env.d.ts', NEXT_ENV_DEV)
    write(rootPath, 'apps/web/next-env.d.ts', NEXT_ENV_DEV)
    run(rootPath, 'add', 'apps/web/next-env.d.ts')

    await deactivateSpotlightCore(ctx, rootPath)

    expect(run(rootPath, 'symbolic-ref', '--short', 'HEAD')).toBe('main')
    // The untracked one is left as it was, like any untracked root file.
    expect(read(rootPath, 'next-env.d.ts')).toBe(NEXT_ENV_DEV)
  })

  it('lets a workspace that tracks it take the path over an untracked one', async () => {
    write(rootPath, 'next-env.d.ts', NEXT_ENV_DEV)
    write(worktreePath, 'next-env.d.ts', NEXT_ENV)
    run(worktreePath, 'add', 'next-env.d.ts')

    await activateSpotlightCore(ctx, rootPath, worktreePath)

    expect(read(rootPath, 'next-env.d.ts')).toBe(NEXT_ENV)
  })

  it('still guards any other untracked file that would be overwritten', async () => {
    write(rootPath, 'scratch.txt', 'precious-untracked\n')
    write(worktreePath, 'scratch.txt', 'workspace-version\n')
    run(worktreePath, 'add', 'scratch.txt')

    await expect(activateSpotlightCore(ctx, rootPath, worktreePath)).rejects.toMatchObject({
      code: 'untracked-collision'
    })
  })
})
