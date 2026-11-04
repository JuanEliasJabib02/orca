import { describe, expect, it, vi } from 'vitest'
import { resolveSyntaxPaletteMonacoTheme } from './use-editor-monaco-theme'

vi.mock('@/store', () => ({ useAppStore: vi.fn() }))
vi.mock('@/hooks/use-monaco-theme', () => ({ useMonacoTheme: vi.fn() }))
vi.mock('@/i18n/i18n', () => ({ translate: (_key: string, fallback: string) => fallback }))

describe('resolveSyntaxPaletteMonacoTheme', () => {
  it('defers to the app or editor theme for the default, missing or unknown palette', () => {
    expect(resolveSyntaxPaletteMonacoTheme('default', true)).toBeNull()
    expect(resolveSyntaxPaletteMonacoTheme(undefined, false)).toBeNull()
    expect(resolveSyntaxPaletteMonacoTheme('no-such-palette', true)).toBeNull()
  })

  it('paints One Dark Pro in dark mode and One Light in light mode', () => {
    expect(resolveSyntaxPaletteMonacoTheme('one-dark-pro', true)).toBe('one-dark-pro')
    expect(resolveSyntaxPaletteMonacoTheme('one-dark-pro', false)).toBe('one-light')
  })

  it('paints the custom palette in both modes', () => {
    expect(resolveSyntaxPaletteMonacoTheme('custom', true)).toBe('orca-custom')
    expect(resolveSyntaxPaletteMonacoTheme('custom', false)).toBe('orca-custom')
  })
})
