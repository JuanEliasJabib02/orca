import { describe, expect, it } from 'vitest'
import {
  resolveSpotlightServerCommand,
  resolveSpotlightServerCommandTemplate
} from './spotlight-server-command'
import {
  fillSpotlightVariant,
  formatSpotlightVariant,
  isSafeSpotlightVariant,
  spotlightCommandNeedsVariant
} from './spotlight-server-variant'

const LOCAL =
  'pnpm exec dotenv -e .env.{variant}.local -e .env.{variant} -- pnpm --filter @ae/{variant} dev'

const UNSAFE = [
  '',
  ' ',
  'do pt',
  'do;rm -rf ~',
  '$(whoami)',
  '`id`',
  'do&&x',
  '../do',
  'x'.repeat(65)
]

describe('isSafeSpotlightVariant', () => {
  it('accepts plain tokens only', () => {
    for (const variant of ['do', 'DO', 'pt_br', 'es-2', 'x'.repeat(64)]) {
      expect(isSafeSpotlightVariant(variant)).toBe(true)
    }
    for (const variant of [...UNSAFE, null, undefined, 7]) {
      expect(isSafeSpotlightVariant(variant)).toBe(false)
    }
  })
})

describe('fillSpotlightVariant', () => {
  it('fills every placeholder', () => {
    expect(fillSpotlightVariant(LOCAL, 'do')).toBe(
      'pnpm exec dotenv -e .env.do.local -e .env.do -- pnpm --filter @ae/do dev'
    )
  })

  it('leaves a command without the placeholder alone, whatever the variant', () => {
    expect(fillSpotlightVariant('pnpm local', undefined)).toBe('pnpm local')
    expect(fillSpotlightVariant('pnpm local', 'do; rm -rf ~')).toBe('pnpm local')
  })

  it('refuses a missing or unsafe variant instead of typing the placeholder', () => {
    expect(fillSpotlightVariant('pnpm dev:{variant}', null)).toBeNull()
    expect(fillSpotlightVariant('pnpm dev:{variant}', undefined)).toBeNull()
    for (const variant of UNSAFE) {
      expect(fillSpotlightVariant('pnpm dev:{variant}', variant)).toBeNull()
    }
  })

  it('tells which commands need a variant', () => {
    expect(spotlightCommandNeedsVariant('pnpm dev:{variant}')).toBe(true)
    expect(spotlightCommandNeedsVariant('pnpm dev:do')).toBe(false)
    expect(formatSpotlightVariant('do')).toBe('DO')
  })
})

describe('resolveSpotlightServerCommand with a variant', () => {
  const config = {
    local: LOCAL,
    dev: 'pnpm dev:{variant}',
    prod: 'pnpm prod:{variant}',
    port: 3001
  }

  it('fills the chosen variant, then appends the port', () => {
    expect(resolveSpotlightServerCommand({ config, env: 'dev', variant: 'pt' })).toBe(
      'pnpm dev:pt --port 3001'
    )
    expect(resolveSpotlightServerCommand({ config, env: 'local', variant: 'do' })).toBe(
      'pnpm exec dotenv -e .env.do.local -e .env.do -- pnpm --filter @ae/do dev --port 3001'
    )
  })

  it('resolves to nothing while no safe variant is chosen', () => {
    expect(resolveSpotlightServerCommand({ config, env: 'prod' })).toBeNull()
    expect(resolveSpotlightServerCommand({ config, env: 'prod', variant: 'do pt' })).toBeNull()
  })

  it('uses a detected variant template like a typed one', () => {
    const detected = { dev: 'pnpm dev:{variant}', prod: 'pnpm prod:{variant}' }

    expect(resolveSpotlightServerCommand({ detected, env: 'local', variant: 'ec' })).toBe(
      'pnpm dev:ec'
    )
  })

  it('ignores the variant for a command that does not use it', () => {
    expect(
      resolveSpotlightServerCommand({ config: { dev: 'pnpm dev' }, env: 'dev', variant: 'do' })
    ).toBe('pnpm dev')
  })

  it('keeps the placeholder in the template', () => {
    expect(resolveSpotlightServerCommandTemplate({ config, env: 'dev' })).toBe(
      'pnpm dev:{variant} --port 3001'
    )
    expect(resolveSpotlightServerCommandTemplate({ config: {}, env: 'dev' })).toBeNull()
  })
})
