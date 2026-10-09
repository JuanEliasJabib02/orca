import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { detectSpotlightServerScripts } from './spotlight-server-script-detection'

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'orca-spotlight-variant-detect-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

async function writePackageJson(scripts: Record<string, string>, extra = {}): Promise<void> {
  await writeFile(
    join(root, 'package.json'),
    JSON.stringify({ packageManager: 'pnpm@10.0.0', scripts, ...extra })
  )
}

async function makeApps(...names: string[]): Promise<void> {
  for (const name of names) {
    await mkdir(join(root, 'apps', name), { recursive: true })
  }
}

// The landing repo: one Next app per country, plus scripts for countries whose app is gone.
const LANDING_CODES = ['pt', 'es', 'co', 'br', 'mx', 'us', 'do', 'gb', 'ec']
const LANDING_SCRIPTS: Record<string, string> = {
  prepare: 'husky',
  lint: 'eslint .',
  ...Object.fromEntries(LANDING_CODES.map((code) => [`dev:${code}`, `dotenv -- next dev`])),
  ...Object.fromEntries(LANDING_CODES.map((code) => [`prod:${code}`, `dotenv -- next dev`])),
  'build:do': 'next build'
}

describe('detectSpotlightServerScripts variants', () => {
  it('detects a landing-like repo: countries with an apps/<V> app, sorted', async () => {
    await writePackageJson(LANDING_SCRIPTS)
    await makeApps('BR', 'DO', 'EC', 'ES', 'GB', 'PT')

    const result = await detectSpotlightServerScripts(root)

    expect(result.variants).toEqual(['br', 'do', 'ec', 'es', 'gb', 'pt'])
  })

  it('drops stale codes whose app folder is gone (co, mx, us)', async () => {
    await writePackageJson(LANDING_SCRIPTS)
    await makeApps('DO', 'PT')

    expect((await detectSpotlightServerScripts(root)).variants).toEqual(['do', 'pt'])
  })

  it('defaults Dev and Prod to the variant scripts; Local falls back to Dev at resolve time', async () => {
    await writePackageJson(LANDING_SCRIPTS)
    await makeApps('DO', 'PT')

    expect((await detectSpotlightServerScripts(root)).detected).toEqual({
      dev: 'pnpm dev:{variant}',
      prod: 'pnpm prod:{variant}'
    })
  })

  it('keeps an exact environment script over the variant template', async () => {
    await writePackageJson({ ...LANDING_SCRIPTS, prod: 'next start' })
    await makeApps('DO', 'PT')

    expect((await detectSpotlightServerScripts(root)).detected).toEqual({
      dev: 'pnpm dev:{variant}',
      prod: 'pnpm prod'
    })
  })

  it('builds the template in the package manager form', async () => {
    await writePackageJson(LANDING_SCRIPTS, { packageManager: 'npm@10.0.0' })
    await makeApps('DO', 'PT')

    expect((await detectSpotlightServerScripts(root)).detected.dev).toBe('npm run dev:{variant} --')
  })

  it('matches app folders ignoring case', async () => {
    await writePackageJson({ 'dev:DO': 'x', 'dev:pt': 'x' })
    await makeApps('do', 'Pt')

    expect((await detectSpotlightServerScripts(root)).variants).toEqual(['DO', 'pt'])
  })

  it('counts dev:<v> scripts as variants when the repo has no apps/ folder', async () => {
    await writePackageJson({ 'dev:do': 'x', 'dev:pt': 'x' })

    expect((await detectSpotlightServerScripts(root)).variants).toEqual(['do', 'pt'])
  })

  it('still reports variants when the package manager is ambiguous', async () => {
    await writePackageJson({ 'dev:do': 'x', 'dev:pt': 'x' }, { packageManager: undefined })
    await writeFile(join(root, 'pnpm-lock.yaml'), '')
    await writeFile(join(root, 'yarn.lock'), '')

    const result = await detectSpotlightServerScripts(root)

    expect(result.variants).toEqual(['do', 'pt'])
    expect(result.detected).toEqual({})
  })

  describe('repos without variants show nothing new', () => {
    it('a plain dev script makes dev:* helpers, not variants', async () => {
      await writePackageJson({ dev: 'run-p dev:*', 'dev:next': 'next dev', 'dev:convex': 'x' })

      const result = await detectSpotlightServerScripts(root)

      expect(result.variants).toBeUndefined()
      expect(result.detected).toEqual({ dev: 'pnpm dev' })
    })

    it('a single dev:<v> script is not a choice', async () => {
      await writePackageJson({ local: 'next dev', 'dev:web': 'vite' })

      expect((await detectSpotlightServerScripts(root)).variants).toBeUndefined()
    })

    it('fewer than two codes with an app folder are not a choice', async () => {
      await writePackageJson({ 'dev:do': 'x', 'dev:mx': 'x', 'dev:us': 'x' })
      await makeApps('DO', 'web')

      const result = await detectSpotlightServerScripts(root)

      expect(result.variants).toBeUndefined()
      expect(result.detected).toEqual({})
    })

    it('ignores codes that are unsafe to type', async () => {
      await writePackageJson({ 'dev:do': 'x', 'dev:$(id)': 'x', 'dev:a b': 'x' })

      expect((await detectSpotlightServerScripts(root)).variants).toBeUndefined()
    })

    it('a repo with ordinary scripts gets no variants field', async () => {
      await writePackageJson({ dev: 'next dev', local: 'next dev', prod: 'next start' })

      expect(await detectSpotlightServerScripts(root)).toEqual({
        detected: { local: 'pnpm local', dev: 'pnpm dev', prod: 'pnpm prod' },
        scriptCommands: ['pnpm dev', 'pnpm local', 'pnpm prod']
      })
    })
  })
})
