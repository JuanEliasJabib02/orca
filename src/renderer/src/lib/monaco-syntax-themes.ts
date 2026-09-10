import type * as monaco from 'monaco-editor'
import { translate } from '@/i18n/i18n'
import { hexColorLuminance } from '../../../shared/color-validation'
import {
  DEFAULT_EDITOR_CUSTOM_THEME,
  EDITOR_SYNTAX_ROLES,
  ONE_DARK_PRO_COLORS,
  ONE_LIGHT_COLORS,
  type EditorCustomTheme,
  type EditorSyntaxRole
} from '../../../shared/editor-custom-theme'

// Why: user-selectable Monaco syntax themes. Monaco themes are global (setTheme
// swaps colors for every mounted editor), so a single resolved name drives all
// editor surfaces uniformly. `default` keeps Monaco's built-in vs/vs-dark.

/** Stored in GlobalSettings.editorTheme; missing/unknown falls back to this. */
export const DEFAULT_EDITOR_THEME_ID = 'default'
/** Selected when the user builds their own palette (see editor-custom-theme.ts). */
export const CUSTOM_EDITOR_THEME_ID = 'custom'
/** Monaco theme name backing the custom palette; redefined as the user edits. */
export const CUSTOM_MONACO_THEME_NAME = 'orca-custom'

export type EditorSyntaxThemeOption = {
  id: string
  /** Registered Monaco theme name applied under the given app appearance. */
  dark: string
  light: string
}

// Single source of truth: which Monaco token types each role paints. Drives the
// built-in One Dark Pro / One Light themes AND the custom builder, so they never
// drift. Only tokens Monaco's *syntactic* tokenizer actually emits are listed —
// it has no semantic highlighting, so function vs variable names both come
// through as `identifier` and share the `variable` role.
const ROLE_TOKENS: Record<EditorSyntaxRole, string[]> = {
  background: [],
  foreground: [],
  comment: ['comment', 'comment.doc'],
  keyword: ['keyword', 'keyword.json', 'keyword.flow'],
  string: ['string', 'string.escape', 'regexp', 'string.value.json', 'attribute.value'],
  number: ['number', 'number.float', 'number.hex', 'number.json', 'constant.numeric'],
  type: ['type', 'type.identifier', 'namespace', 'struct', 'class', 'interface', 'enum'],
  variable: ['identifier', 'variable', 'variable.predefined', 'string.key.json'],
  punctuation: [
    'delimiter',
    'delimiter.bracket',
    'delimiter.parenthesis',
    'delimiter.square',
    'delimiter.angle',
    'delimiter.html',
    'operator'
  ],
  tag: ['tag', 'metatag', 'tag.id'],
  attribute: ['attribute.name']
}

const hex = (value: string): string => value.replace('#', '')

// TextMate scope → color rules for One Dark Pro, mirroring the real extension so
// TextMate-tokenized languages (e.g. Python) read identically to VS Code / Cursor.
// Monaco matches these hierarchically, so a rule for `entity.name.function` also
// colors `entity.name.function.python`.
const ONE_DARK_PRO_SCOPE_RULES: monaco.editor.ITokenThemeRule[] = [
  { token: 'comment', foreground: '7f848e', fontStyle: 'italic' },
  { token: 'punctuation.definition.comment', foreground: '7f848e', fontStyle: 'italic' },
  { token: 'keyword', foreground: 'c678dd' },
  { token: 'storage', foreground: 'c678dd' },
  { token: 'keyword.operator', foreground: 'abb2bf' },
  { token: 'keyword.operator.logical', foreground: '56b6c2' },
  { token: 'keyword.operator.arithmetic', foreground: '56b6c2' },
  { token: 'keyword.operator.comparison', foreground: '56b6c2' },
  { token: 'string', foreground: '98c379' },
  { token: 'constant.character.escape', foreground: '56b6c2' },
  { token: 'constant.numeric', foreground: 'd19a66' },
  { token: 'constant.language', foreground: 'd19a66' },
  { token: 'constant', foreground: 'd19a66' },
  { token: 'entity.name.function', foreground: '61afef' },
  { token: 'meta.function-call', foreground: '61afef' },
  { token: 'support.function', foreground: '56b6c2' },
  { token: 'meta.function.decorator', foreground: '61afef' },
  { token: 'entity.name.type', foreground: 'e5c07b' },
  { token: 'entity.name.class', foreground: 'e5c07b' },
  { token: 'entity.name.namespace', foreground: 'e5c07b' },
  { token: 'support.class', foreground: 'e5c07b' },
  { token: 'support.type', foreground: 'e5c07b' },
  { token: 'support.type.python', foreground: '56b6c2' },
  { token: 'variable', foreground: 'e06c75' },
  { token: 'variable.parameter', foreground: 'abb2bf' },
  { token: 'support.variable', foreground: 'e06c75' },
  { token: 'entity.name.tag', foreground: 'e06c75' },
  { token: 'entity.other.attribute-name', foreground: 'd19a66' },
  { token: 'punctuation', foreground: 'abb2bf' }
]

const ONE_LIGHT_SCOPE_RULES: monaco.editor.ITokenThemeRule[] = [
  { token: 'comment', foreground: 'a0a1a7', fontStyle: 'italic' },
  { token: 'punctuation.definition.comment', foreground: 'a0a1a7', fontStyle: 'italic' },
  { token: 'keyword', foreground: 'a626a4' },
  { token: 'storage', foreground: 'a626a4' },
  { token: 'keyword.operator', foreground: '383a42' },
  { token: 'keyword.operator.logical', foreground: '0184bc' },
  { token: 'keyword.operator.arithmetic', foreground: '0184bc' },
  { token: 'keyword.operator.comparison', foreground: '0184bc' },
  { token: 'string', foreground: '50a14f' },
  { token: 'constant.character.escape', foreground: '0184bc' },
  { token: 'constant.numeric', foreground: '986801' },
  { token: 'constant.language', foreground: '986801' },
  { token: 'constant', foreground: '986801' },
  { token: 'entity.name.function', foreground: '4078f2' },
  { token: 'meta.function-call', foreground: '4078f2' },
  { token: 'support.function', foreground: '0184bc' },
  { token: 'meta.function.decorator', foreground: '4078f2' },
  { token: 'entity.name.type', foreground: 'c18401' },
  { token: 'entity.name.class', foreground: 'c18401' },
  { token: 'entity.name.namespace', foreground: 'c18401' },
  { token: 'support.class', foreground: 'c18401' },
  { token: 'support.type', foreground: 'c18401' },
  { token: 'support.type.python', foreground: '0184bc' },
  { token: 'variable', foreground: 'e45649' },
  { token: 'variable.parameter', foreground: '383a42' },
  { token: 'support.variable', foreground: 'e45649' },
  { token: 'entity.name.tag', foreground: 'e45649' },
  { token: 'entity.other.attribute-name', foreground: '986801' },
  { token: 'punctuation', foreground: '383a42' }
]

/** Compile a role palette into a Monaco theme; extraColors overrides chrome,
 *  scopeRules adds TextMate scope colors for TextMate-tokenized languages. */
function buildMonacoThemeData(
  base: monaco.editor.BuiltinTheme,
  colors: EditorCustomTheme,
  extraColors: Record<string, string> = {},
  scopeRules: monaco.editor.ITokenThemeRule[] = []
): monaco.editor.IStandaloneThemeData {
  const rules: monaco.editor.ITokenThemeRule[] = [
    { token: '', foreground: hex(colors.foreground), background: hex(colors.background) }
  ]
  for (const role of EDITOR_SYNTAX_ROLES) {
    for (const token of ROLE_TOKENS[role]) {
      const rule: monaco.editor.ITokenThemeRule = { token, foreground: hex(colors[role]) }
      if (role === 'comment') {
        rule.fontStyle = 'italic'
      }
      rules.push(rule)
    }
  }
  rules.push(...scopeRules)
  return {
    base,
    inherit: true,
    rules,
    colors: {
      'editor.background': colors.background,
      'editor.foreground': colors.foreground,
      'editorLineNumber.foreground': colors.comment,
      'editorLineNumber.activeForeground': colors.foreground,
      'editorGutter.background': colors.background,
      'editorCursor.foreground': colors.foreground,
      ...extraColors
    }
  }
}

const ONE_DARK_PRO = buildMonacoThemeData(
  'vs-dark',
  ONE_DARK_PRO_COLORS,
  {
    'editor.lineHighlightBackground': '#2c313c',
    'editor.selectionBackground': '#67769660',
    'editor.selectionHighlightBackground': '#3e445150',
    'editor.findMatchBackground': '#42557b',
    'editor.findMatchHighlightBackground': '#314365',
    'editorCursor.foreground': '#528bff',
    'editorLineNumber.foreground': '#495162',
    'editorIndentGuide.background': '#3b4048',
    'editorIndentGuide.activeBackground': '#5c6370',
    'editorWhitespace.foreground': '#3b4048'
  },
  ONE_DARK_PRO_SCOPE_RULES
)

const ONE_LIGHT = buildMonacoThemeData(
  'vs',
  ONE_LIGHT_COLORS,
  {
    'editor.lineHighlightBackground': '#f0f0f1',
    'editor.selectionBackground': '#e5e5e6',
    'editor.selectionHighlightBackground': '#e5e5e650',
    'editorCursor.foreground': '#526fff',
    'editorLineNumber.foreground': '#9d9d9f',
    'editorIndentGuide.background': '#eaeaeb',
    'editorIndentGuide.activeBackground': '#a0a1a7',
    'editorWhitespace.foreground': '#d4d4d5'
  },
  ONE_LIGHT_SCOPE_RULES
)

/** Compile a user palette into a Monaco theme definition. */
export function buildCustomMonacoTheme(
  colors: EditorCustomTheme
): monaco.editor.IStandaloneThemeData {
  // Pick the built-in base by background darkness so un-mapped tokens inherit sane defaults.
  const base = hexColorLuminance(colors.background) < 0.4 ? 'vs-dark' : 'vs'
  return buildMonacoThemeData(base, colors)
}

/** (Re)define the custom Monaco theme from the given palette. */
export function applyCustomMonacoTheme(
  monacoInstance: typeof monaco,
  colors: EditorCustomTheme
): void {
  monacoInstance.editor.defineTheme(CUSTOM_MONACO_THEME_NAME, buildCustomMonacoTheme(colors))
}

/** Picker order; the first entry is the fallback for unknown ids. */
export const EDITOR_SYNTAX_THEME_OPTIONS: EditorSyntaxThemeOption[] = [
  { id: DEFAULT_EDITOR_THEME_ID, dark: 'vs-dark', light: 'vs' },
  { id: 'one-dark-pro', dark: 'one-dark-pro', light: 'one-light' },
  // Custom is a single hand-built palette applied in both light and dark app modes.
  { id: CUSTOM_EDITOR_THEME_ID, dark: CUSTOM_MONACO_THEME_NAME, light: CUSTOM_MONACO_THEME_NAME }
]

/** Human-readable label for the picker. Kept out of the option list so the
 *  registry stays a pure data table and labels can be translated lazily. */
export function getEditorSyntaxThemeLabel(id: string): string {
  switch (id) {
    case 'one-dark-pro':
      return translate('auto.lib.monacoSyntaxThemes.oneDarkPro', 'One Dark Pro')
    case CUSTOM_EDITOR_THEME_ID:
      return translate('auto.lib.monacoSyntaxThemes.custom', 'Custom (build your own)')
    default:
      return translate('auto.lib.monacoSyntaxThemes.default', 'Default (VS)')
  }
}

/** Resolve the Monaco theme name to apply for the current appearance. */
export function resolveMonacoThemeName(editorTheme: string | undefined, isDark: boolean): string {
  const option =
    EDITOR_SYNTAX_THEME_OPTIONS.find((o) => o.id === editorTheme) ?? EDITOR_SYNTAX_THEME_OPTIONS[0]
  return isDark ? option.dark : option.light
}

/** Register the custom themes on the Monaco namespace (idempotent per name). */
export function registerMonacoSyntaxThemes(monacoInstance: typeof monaco): void {
  monacoInstance.editor.defineTheme('one-dark-pro', ONE_DARK_PRO)
  monacoInstance.editor.defineTheme('one-light', ONE_LIGHT)
  // Seed the custom theme so its name always resolves; the app hook keeps it current.
  applyCustomMonacoTheme(monacoInstance, DEFAULT_EDITOR_CUSTOM_THEME)
}
