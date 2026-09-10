import type React from 'react'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import {
  DEFAULT_EDITOR_CUSTOM_THEME,
  EDITOR_SYNTAX_ROLES,
  normalizeEditorCustomTheme,
  type EditorCustomTheme,
  type EditorSyntaxRole
} from '../../../../shared/editor-custom-theme'
import { hexColorLuminance } from '../../../../shared/color-validation'
import {
  CUSTOM_EDITOR_THEME_ID,
  DEFAULT_EDITOR_THEME_ID,
  EDITOR_SYNTAX_THEME_OPTIONS,
  getEditorSyntaxThemeLabel
} from '@/lib/monaco-syntax-themes'
import { translate } from '@/i18n/i18n'
import { Button } from '../ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { SearchableSetting } from './SearchableSetting'
import { ColorField, SettingsRow } from './SettingsFormControls'

type EditorSyntaxThemeSettingProps = {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
}

const ROLE_LABELS: Record<EditorSyntaxRole, [string, string]> = {
  background: ['auto.components.settings.EditorSyntaxThemeSetting.role.background', 'Background'],
  foreground: ['auto.components.settings.EditorSyntaxThemeSetting.role.foreground', 'Default text'],
  comment: ['auto.components.settings.EditorSyntaxThemeSetting.role.comment', 'Comments'],
  keyword: ['auto.components.settings.EditorSyntaxThemeSetting.role.keyword', 'Keywords'],
  string: ['auto.components.settings.EditorSyntaxThemeSetting.role.string', 'Strings'],
  number: ['auto.components.settings.EditorSyntaxThemeSetting.role.number', 'Numbers'],
  type: ['auto.components.settings.EditorSyntaxThemeSetting.role.type', 'Types & Classes'],
  variable: [
    'auto.components.settings.EditorSyntaxThemeSetting.role.variable',
    'Identifiers & Variables'
  ],
  punctuation: [
    'auto.components.settings.EditorSyntaxThemeSetting.role.punctuation',
    'Punctuation & Operators'
  ],
  tag: ['auto.components.settings.EditorSyntaxThemeSetting.role.tag', 'Tags (HTML/JSX)'],
  attribute: ['auto.components.settings.EditorSyntaxThemeSetting.role.attribute', 'Attributes']
}

function getEditorSyntaxRoleLabel(role: EditorSyntaxRole): string {
  const [key, fallback] = ROLE_LABELS[role]
  return translate(key, fallback)
}

type PreviewToken = { text: string; role?: EditorSyntaxRole }

// Tokens mirror how Monaco actually paints TS (capitalized names → type, function
// and variable names both → variable, brackets → punctuation).
const PREVIEW_LINES: PreviewToken[][] = [
  [{ text: '// build your own palette', role: 'comment' }],
  [
    { text: 'import', role: 'keyword' },
    { text: ' ' },
    { text: '{ ', role: 'punctuation' },
    { text: 'compute', role: 'variable' },
    { text: ' }', role: 'punctuation' },
    { text: ' ' },
    { text: 'from', role: 'keyword' },
    { text: ' ' },
    { text: "'./engine'", role: 'string' }
  ],
  [
    { text: 'const', role: 'keyword' },
    { text: ' ' },
    { text: 'MAX', role: 'variable' },
    { text: ' = ', role: 'punctuation' },
    { text: '3', role: 'number' }
  ],
  [
    { text: 'function', role: 'keyword' },
    { text: ' ' },
    { text: 'greet', role: 'variable' },
    { text: '(', role: 'punctuation' },
    { text: 'name', role: 'variable' },
    { text: ': ', role: 'punctuation' },
    { text: 'Person', role: 'type' },
    { text: ') {', role: 'punctuation' }
  ],
  [
    { text: '  ' },
    { text: 'return', role: 'keyword' },
    { text: ' ' },
    { text: 'compute', role: 'variable' },
    { text: '(', role: 'punctuation' },
    { text: 'name', role: 'variable' },
    { text: ')', role: 'punctuation' }
  ],
  [{ text: '}', role: 'punctuation' }]
]

/** Approximate luminance ratio (perceptual heuristic, not gamma-corrected WCAG). */
function contrastRatio(a: string, b: string): number {
  const la = hexColorLuminance(a)
  const lb = hexColorLuminance(b)
  const hi = Math.max(la, lb)
  const lo = Math.min(la, lb)
  return (hi + 0.05) / (lo + 0.05)
}

function CustomThemePreview({ colors }: { colors: EditorCustomTheme }): React.JSX.Element {
  return (
    <pre
      className="overflow-x-auto rounded p-3 font-mono text-xs leading-relaxed"
      style={{ backgroundColor: colors.background, color: colors.foreground }}
    >
      {PREVIEW_LINES.map((line, lineIndex) => (
        <div key={lineIndex}>
          {line.length === 0 ? ' ' : null}
          {line.map((token, tokenIndex) => (
            <span
              key={tokenIndex}
              style={
                token.role
                  ? {
                      color: colors[token.role],
                      fontStyle: token.role === 'comment' ? 'italic' : undefined
                    }
                  : undefined
              }
            >
              {token.text}
            </span>
          ))}
        </div>
      ))}
    </pre>
  )
}

// Custom palette editor. Split out so its per-role normalize/contrast work runs
// only while the custom theme is selected, not on every settings render.
function CustomThemeEditor({
  settings,
  updateSettings
}: EditorSyntaxThemeSettingProps): React.JSX.Element {
  const effectiveColors = normalizeEditorCustomTheme(settings.editorCustomTheme)
  const lowContrast = contrastRatio(effectiveColors.background, effectiveColors.foreground) < 2.5

  const setRoleColor = (role: EditorSyntaxRole, value: string): void => {
    // Carry only known roles so obsolete keys from older builds aren't re-persisted.
    const next = { ...DEFAULT_EDITOR_CUSTOM_THEME }
    for (const knownRole of EDITOR_SYNTAX_ROLES) {
      const current = settings.editorCustomTheme?.[knownRole]
      if (typeof current === 'string') {
        next[knownRole] = current
      }
    }
    next[role] = value
    updateSettings({ editorCustomTheme: next })
  }

  return (
    <div className="mt-2 space-y-3 rounded-md border border-border bg-muted/30 p-3">
      <div className="flex items-center justify-between gap-4">
        <p className="text-xs text-muted-foreground">
          {translate(
            'auto.components.settings.EditorSyntaxThemeSetting.customHint',
            'Pick a color for each syntax role. Changes preview live below.'
          )}
        </p>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => updateSettings({ editorCustomTheme: { ...DEFAULT_EDITOR_CUSTOM_THEME } })}
        >
          {translate(
            'auto.components.settings.EditorSyntaxThemeSetting.reset',
            'Reset to One Dark Pro'
          )}
        </Button>
      </div>

      <CustomThemePreview colors={effectiveColors} />

      {lowContrast ? (
        <p className="text-xs text-amber-600 dark:text-amber-300">
          {translate(
            'auto.components.settings.EditorSyntaxThemeSetting.lowContrast',
            'Background and Default text are very close — editor code may be hard to read.'
          )}
        </p>
      ) : null}

      <div className="grid grid-cols-1 gap-x-6 sm:grid-cols-2">
        {EDITOR_SYNTAX_ROLES.map((role) => (
          <ColorField
            key={role}
            label={getEditorSyntaxRoleLabel(role)}
            description=""
            value={settings.editorCustomTheme?.[role] ?? DEFAULT_EDITOR_CUSTOM_THEME[role]}
            fallback={DEFAULT_EDITOR_CUSTOM_THEME[role]}
            onChange={(value) => setRoleColor(role, value)}
          />
        ))}
      </div>
    </div>
  )
}

export function EditorSyntaxThemeSetting({
  settings,
  updateSettings
}: EditorSyntaxThemeSettingProps): React.JSX.Element {
  const title = translate(
    'auto.components.settings.EditorSyntaxThemeSetting.title',
    'Editor Color Theme'
  )
  const description = translate(
    'auto.components.settings.EditorSyntaxThemeSetting.description',
    'Syntax highlighting palette for file editors and diffs. Follows light/dark automatically.'
  )
  // Resolve to a known id so an unknown/legacy value doesn't blank the picker
  // while editors fall back to Default.
  const selected =
    EDITOR_SYNTAX_THEME_OPTIONS.find((option) => option.id === settings.editorTheme)?.id ??
    DEFAULT_EDITOR_THEME_ID

  return (
    <SearchableSetting
      title={title}
      description={description}
      keywords={[
        'editor',
        'theme',
        'syntax',
        'color',
        'colours',
        'highlight',
        'one dark pro',
        'custom',
        'monaco'
      ]}
    >
      <SettingsRow
        label={title}
        description={description}
        control={
          <Select
            value={selected}
            onValueChange={(value) => updateSettings({ editorTheme: value })}
          >
            <SelectTrigger size="sm" className="min-w-[220px]" aria-label={title}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {EDITOR_SYNTAX_THEME_OPTIONS.map((option) => (
                <SelectItem key={option.id} value={option.id}>
                  {getEditorSyntaxThemeLabel(option.id)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />

      {selected === CUSTOM_EDITOR_THEME_ID ? (
        <CustomThemeEditor settings={settings} updateSettings={updateSettings} />
      ) : null}
    </SearchableSetting>
  )
}
