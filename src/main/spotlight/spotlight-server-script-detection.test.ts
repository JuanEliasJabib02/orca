import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { detectSpotlightServerScripts } from './spotlight-server-script-detection'

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'orca-spotlight-server-detect-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

async function writePackageJson(contents: unknown): Promise<void> {
  await writeFile(
    join(root, 'package.json'),
    typeof contents === 'string' ? contents : JSON.stringify(contents)
  )
}

const SCRIPTS = { local: 'next dev', dev: 'next dev', prod: 'next start', build: 'next build' }

describe('detectSpotlightServerScripts', () => {
  it('builds pnpm commands from the packageManager field', async () => {
    await writePackageJson({ packageManager: 'pnpm@9.1.0', scripts: SCRIPTS })

    const result = await detectSpotlightServerScripts(root)

    expect(result.detected).toEqual({
      local: 'pnpm local',
      dev: 'pnpm dev',
      prod: 'pnpm prod'
    })
  })

  it('detects pnpm from its lockfile', async () => {
    await writePackageJson({ scripts: { dev: 'vite' } })
    await writeFile(join(root, 'pnpm-lock.yaml'), '')

    expect((await detectSpotlightServerScripts(root)).detected).toEqual({ dev: 'pnpm dev' })
  })

  it('builds yarn commands', async () => {
    await writePackageJson({ packageManager: 'yarn@4.0.0', scripts: SCRIPTS })

    expect((await detectSpotlightServerScripts(root)).detected).toEqual({
      local: 'yarn local',
      dev: 'yarn dev',
      prod: 'yarn prod'
    })
  })

  it('builds bun commands with `bun run`', async () => {
    await writePackageJson({ scripts: { dev: 'bun --hot server.ts' } })
    await writeFile(join(root, 'bun.lock'), '')

    expect((await detectSpotlightServerScripts(root)).detected).toEqual({ dev: 'bun run dev' })
  })

  it('builds npm commands with a trailing `--` so an appended --port reaches the script', async () => {
    await writePackageJson({ scripts: SCRIPTS })
    await writeFile(join(root, 'package-lock.json'), '{}')

    expect((await detectSpotlightServerScripts(root)).detected).toEqual({
      local: 'npm run local --',
      dev: 'npm run dev --',
      prod: 'npm run prod --'
    })
  })

  it('falls back to npm when no package manager can be told', async () => {
    await writePackageJson({ scripts: { dev: 'vite' } })

    expect((await detectSpotlightServerScripts(root)).detected).toEqual({ dev: 'npm run dev --' })
  })

  it('only detects environments whose script has exactly that name', async () => {
    await writePackageJson({
      packageManager: 'pnpm@9.0.0',
      scripts: { dev: 'next dev', 'dev:do': 'next dev', 'prod:do': 'next start', start: 'node .' }
    })

    expect((await detectSpotlightServerScripts(root)).detected).toEqual({ dev: 'pnpm dev' })
  })

  it('suggests every dev/local/prod/start script, sorted', async () => {
    await writePackageJson({
      packageManager: 'pnpm@9.0.0',
      scripts: {
        'prod:do': 'next start',
        build: 'next build',
        'dev:mx': 'next dev',
        start: 'node .',
        lint: 'oxlint',
        'dev:do': 'next dev',
        'local:db': 'docker compose up'
      }
    })

    expect((await detectSpotlightServerScripts(root)).scriptCommands).toEqual([
      'pnpm dev:do',
      'pnpm dev:mx',
      'pnpm local:db',
      'pnpm prod:do',
      'pnpm start'
    ])
  })

  it('uses the package manager form for suggestions too', async () => {
    await writePackageJson({ packageManager: 'npm@10.0.0', scripts: { 'dev:do': 'next dev' } })

    expect((await detectSpotlightServerScripts(root)).scriptCommands).toEqual(['npm run dev:do --'])
  })

  it('skips script names that are not safe to type into a terminal', async () => {
    await writePackageJson({
      packageManager: 'pnpm@9.0.0',
      scripts: { 'dev; rm -rf ~': 'x', 'dev$(whoami)': 'x', 'dev && echo': 'x', 'dev:ok': 'x' }
    })

    expect((await detectSpotlightServerScripts(root)).scriptCommands).toEqual(['pnpm dev:ok'])
  })

  it('returns nothing when there are no scripts', async () => {
    await writePackageJson({ name: 'no-scripts', packageManager: 'pnpm@9.0.0' })

    expect(await detectSpotlightServerScripts(root)).toEqual({ detected: {}, scriptCommands: [] })
  })

  it('returns nothing when no script is a server script', async () => {
    await writePackageJson({
      packageManager: 'pnpm@9.0.0',
      scripts: { build: 'tsc', test: 'vitest' }
    })

    expect(await detectSpotlightServerScripts(root)).toEqual({ detected: {}, scriptCommands: [] })
  })

  it('returns nothing when there is no package.json', async () => {
    expect(await detectSpotlightServerScripts(root)).toEqual({ detected: {}, scriptCommands: [] })
  })

  it('returns nothing when the root does not exist', async () => {
    expect(await detectSpotlightServerScripts(join(root, 'missing'))).toEqual({
      detected: {},
      scriptCommands: []
    })
  })

  it('returns nothing for invalid JSON', async () => {
    await writePackageJson('{ "scripts": { "dev": ')

    expect(await detectSpotlightServerScripts(root)).toEqual({ detected: {}, scriptCommands: [] })
  })

  it('returns nothing when scripts is not an object', async () => {
    await writePackageJson({ packageManager: 'pnpm@9.0.0', scripts: ['dev'] })

    expect(await detectSpotlightServerScripts(root)).toEqual({ detected: {}, scriptCommands: [] })
  })

  it('returns nothing for an oversized package.json', async () => {
    await writePackageJson({
      packageManager: 'pnpm@9.0.0',
      scripts: { dev: 'next dev' },
      padding: 'x'.repeat(129 * 1024)
    })

    expect(await detectSpotlightServerScripts(root)).toEqual({ detected: {}, scriptCommands: [] })
  })

  it('returns nothing when conflicting lockfiles leave the package manager ambiguous', async () => {
    await writePackageJson({ scripts: { dev: 'vite' } })
    await writeFile(join(root, 'pnpm-lock.yaml'), '')
    await writeFile(join(root, 'yarn.lock'), '')

    expect(await detectSpotlightServerScripts(root)).toEqual({ detected: {}, scriptCommands: [] })
  })
})
