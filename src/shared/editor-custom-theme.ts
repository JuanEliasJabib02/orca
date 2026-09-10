import { normalizeHexColor } from './color-validation'

// Why: user-built Monaco syntax palette. Roles map to Monaco token types in
// ROLE_TOKENS (renderer/lib/monaco-syntax-themes.ts), which explains the set.

export type EditorSyntaxRole =
  | 'background'
  | 'foreground'
  | 'comment'
  | 'keyword'
  | 'string'
  | 'number'
  | 'type'
  | 'variable'
  | 'punctuation'
  | 'tag'
  | 'attribute'

export type EditorCustomTheme = Record<EditorSyntaxRole, string>

/** UI order for the color editor. */
export const EDITOR_SYNTAX_ROLES = [
  'background',
  'foreground',
  'comment',
  'keyword',
  'string',
  'number',
  'type',
  'variable',
  'punctuation',
  'tag',
  'attribute'
] as const satisfies readonly EditorSyntaxRole[]

/** One Dark Pro palette (also the default seed for a fresh custom theme). */
export const ONE_DARK_PRO_COLORS: EditorCustomTheme = {
  background: '#282c34',
  foreground: '#abb2bf',
  comment: '#5c6370',
  keyword: '#c678dd',
  string: '#98c379',
  number: '#d19a66',
  type: '#e5c07b',
  variable: '#e06c75',
  punctuation: '#abb2bf',
  tag: '#e06c75',
  attribute: '#d19a66'
}

/** Atom One Light palette (paired light variant). */
export const ONE_LIGHT_COLORS: EditorCustomTheme = {
  background: '#fafafa',
  foreground: '#383a42',
  comment: '#a0a1a7',
  keyword: '#a626a4',
  string: '#50a14f',
  number: '#986801',
  type: '#c18401',
  variable: '#e45649',
  punctuation: '#383a42',
  tag: '#e45649',
  attribute: '#986801'
}

export const DEFAULT_EDITOR_CUSTOM_THEME: EditorCustomTheme = ONE_DARK_PRO_COLORS

/** Fill every role from a partial/untrusted value, defaulting invalid entries. */
export function normalizeEditorCustomTheme(value: unknown): EditorCustomTheme {
  const input =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {}
  const output = {} as EditorCustomTheme
  for (const role of EDITOR_SYNTAX_ROLES) {
    output[role] = normalizeHexColor(input[role]) ?? DEFAULT_EDITOR_CUSTOM_THEME[role]
  }
  return output
}
