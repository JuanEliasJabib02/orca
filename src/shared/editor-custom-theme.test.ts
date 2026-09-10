import { describe, it, expect } from 'vitest'
import { hexColorLuminance, normalizeHexColor } from './color-validation'
import {
  DEFAULT_EDITOR_CUSTOM_THEME,
  EDITOR_SYNTAX_ROLES,
  normalizeEditorCustomTheme
} from './editor-custom-theme'

describe('normalizeHexColor', () => {
  it('expands shorthand and lowercases with a leading hash', () => {
    expect(normalizeHexColor('#ABC')).toBe('#aabbcc')
    expect(normalizeHexColor('E06C75')).toBe('#e06c75')
    expect(normalizeHexColor('  #61AFEF  ')).toBe('#61afef')
  })

  it('rejects non-hex input', () => {
    expect(normalizeHexColor('red')).toBeNull()
    expect(normalizeHexColor('#12')).toBeNull()
    expect(normalizeHexColor(42)).toBeNull()
    expect(normalizeHexColor(undefined)).toBeNull()
  })
})

describe('normalizeEditorCustomTheme', () => {
  it('fills every role, defaulting missing or invalid entries', () => {
    const result = normalizeEditorCustomTheme({ keyword: '#fff', string: 'nonsense' })
    expect(result.keyword).toBe('#ffffff')
    expect(result.string).toBe(DEFAULT_EDITOR_CUSTOM_THEME.string)
    for (const role of EDITOR_SYNTAX_ROLES) {
      expect(result[role]).toMatch(/^#[0-9a-f]{6}$/)
    }
  })

  it('returns the full default palette for garbage input', () => {
    expect(normalizeEditorCustomTheme(null)).toEqual(DEFAULT_EDITOR_CUSTOM_THEME)
    expect(normalizeEditorCustomTheme('x')).toEqual(DEFAULT_EDITOR_CUSTOM_THEME)
    expect(normalizeEditorCustomTheme([])).toEqual(DEFAULT_EDITOR_CUSTOM_THEME)
  })
})

describe('hexColorLuminance', () => {
  it('separates the One Dark Pro background (dark) from One Light (light)', () => {
    expect(hexColorLuminance('#282c34')).toBeLessThan(0.4)
    expect(hexColorLuminance('#fafafa')).toBeGreaterThan(0.4)
  })
})
