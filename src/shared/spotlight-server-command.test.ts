import { describe, expect, it } from 'vitest'
import {
  normalizeSpotlightServerUpdate,
  resolveSpotlightServerCommand,
  sanitizeSpotlightServerConfig
} from './spotlight-server-command'

describe('sanitizeSpotlightServerConfig', () => {
  it('trims commands and keeps a valid port', () => {
    expect(
      sanitizeSpotlightServerConfig({
        local: '  pnpm local ',
        dev: 'pnpm dev',
        prod: '\tpnpm prod\n',
        port: 3000
      })
    ).toEqual({ local: 'pnpm local', dev: 'pnpm dev', prod: 'pnpm prod', port: 3000 })
  })

  it('drops blank, non-string and unknown fields', () => {
    expect(
      sanitizeSpotlightServerConfig({ local: '   ', dev: 42, prod: 'pnpm prod', extra: 'x' })
    ).toEqual({ prod: 'pnpm prod' })
  })

  it('accepts the port boundaries and rejects everything else', () => {
    expect(sanitizeSpotlightServerConfig({ port: 1 })).toEqual({ port: 1 })
    expect(sanitizeSpotlightServerConfig({ port: 65535 })).toEqual({ port: 65535 })
    for (const port of [0, -1, 65536, 3000.5, Number.NaN, Infinity, '3000', null]) {
      expect(sanitizeSpotlightServerConfig({ dev: 'pnpm dev', port })).toEqual({ dev: 'pnpm dev' })
    }
  })

  it('drops a command longer than 2000 characters instead of truncating it', () => {
    const atLimit = 'a'.repeat(2000)
    expect(sanitizeSpotlightServerConfig({ dev: atLimit })).toEqual({ dev: atLimit })
    expect(sanitizeSpotlightServerConfig({ dev: 'a'.repeat(2001), prod: 'pnpm prod' })).toEqual({
      prod: 'pnpm prod'
    })
  })

  it('returns undefined when nothing is left', () => {
    expect(sanitizeSpotlightServerConfig({})).toBeUndefined()
    expect(sanitizeSpotlightServerConfig({ local: '  ', port: 0 })).toBeUndefined()
    for (const value of [undefined, null, 'pnpm dev', 3000, true, ['pnpm dev']]) {
      expect(sanitizeSpotlightServerConfig(value)).toBeUndefined()
    }
  })
})

describe('normalizeSpotlightServerUpdate', () => {
  it('sanitizes an object patch', () => {
    expect(normalizeSpotlightServerUpdate({ dev: ' pnpm dev ', port: 3001 })).toEqual({
      dev: 'pnpm dev',
      port: 3001
    })
  })

  it('treats null and an empty object as a clear', () => {
    expect(normalizeSpotlightServerUpdate(null)).toBeNull()
    expect(normalizeSpotlightServerUpdate({})).toBeNull()
    expect(normalizeSpotlightServerUpdate({ dev: '  ', port: 99999 })).toBeNull()
  })

  it('leaves the stored value alone for non-object input', () => {
    for (const value of [undefined, 'pnpm dev', 3000, false, ['pnpm dev']]) {
      expect(normalizeSpotlightServerUpdate(value)).toBeUndefined()
    }
  })
})

describe('resolveSpotlightServerCommand', () => {
  it('prefers the saved command over the detected one', () => {
    expect(
      resolveSpotlightServerCommand({
        config: { dev: 'ax-dev-back' },
        detected: { dev: 'pnpm dev' },
        env: 'dev'
      })
    ).toBe('ax-dev-back')
  })

  it('falls back to the detected command per environment', () => {
    const detected = { local: 'pnpm local', dev: 'pnpm dev', prod: 'pnpm prod' }
    expect(
      resolveSpotlightServerCommand({ config: { dev: 'custom' }, detected, env: 'local' })
    ).toBe('pnpm local')
    expect(
      resolveSpotlightServerCommand({ config: { dev: 'custom' }, detected, env: 'prod' })
    ).toBe('pnpm prod')
  })

  it('ignores a blank saved command and uses the detected one', () => {
    expect(
      resolveSpotlightServerCommand({
        config: { dev: '   ' },
        detected: { dev: 'pnpm dev' },
        env: 'dev'
      })
    ).toBe('pnpm dev')
  })

  it('uses the dev command in local when there is no local one', () => {
    expect(resolveSpotlightServerCommand({ config: { dev: 'pnpm dev:do' }, env: 'local' })).toBe(
      'pnpm dev:do'
    )
    expect(resolveSpotlightServerCommand({ detected: { dev: 'pnpm dev' }, env: 'local' })).toBe(
      'pnpm dev'
    )
    expect(
      resolveSpotlightServerCommand({
        config: { dev: 'saved dev' },
        detected: { dev: 'detected dev' },
        env: 'local'
      })
    ).toBe('saved dev')
  })

  it('keeps a local command over the dev fallback, saved or detected', () => {
    expect(
      resolveSpotlightServerCommand({
        config: { local: 'saved local', dev: 'saved dev' },
        detected: { local: 'detected local' },
        env: 'local'
      })
    ).toBe('saved local')
    expect(
      resolveSpotlightServerCommand({
        config: { dev: 'saved dev' },
        detected: { local: 'detected local' },
        env: 'local'
      })
    ).toBe('detected local')
  })

  it('never falls back across other environments', () => {
    const config = { local: 'pnpm local', dev: 'pnpm dev' }
    expect(resolveSpotlightServerCommand({ config, env: 'prod' })).toBeNull()
    expect(
      resolveSpotlightServerCommand({ config: { local: 'pnpm local' }, env: 'dev' })
    ).toBeNull()
  })

  it('returns null when there is nothing to run', () => {
    expect(resolveSpotlightServerCommand({ env: 'local' })).toBeNull()
    expect(resolveSpotlightServerCommand({ config: {}, detected: {}, env: 'dev' })).toBeNull()
    expect(resolveSpotlightServerCommand({ config: { port: 3000 }, env: 'local' })).toBeNull()
  })

  it('appends the port as --port N', () => {
    expect(
      resolveSpotlightServerCommand({
        config: { dev: 'pnpm dev', port: 3002 },
        env: 'dev'
      })
    ).toBe('pnpm dev --port 3002')
    expect(
      resolveSpotlightServerCommand({
        config: { port: 3004 },
        detected: { dev: 'pnpm dev' },
        env: 'local'
      })
    ).toBe('pnpm dev --port 3004')
  })

  it('ignores an invalid port', () => {
    for (const port of [0, 65536, 3000.5, Number.NaN, -1]) {
      expect(resolveSpotlightServerCommand({ config: { dev: 'pnpm dev', port }, env: 'dev' })).toBe(
        'pnpm dev'
      )
    }
  })
})
