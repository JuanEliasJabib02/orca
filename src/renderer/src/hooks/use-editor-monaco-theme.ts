import { useAppStore } from '@/store'
import { useDocumentDarkTheme } from '@/hooks/use-document-dark-theme'
import { useMonacoTheme } from '@/hooks/use-monaco-theme'
import { useCodeEditorThemeStore } from '@/store/appearance/code-editor-theme'
import {
  DEFAULT_EDITOR_THEME_ID,
  EDITOR_SYNTAX_THEME_OPTIONS,
  resolveMonacoThemeName
} from '@/lib/monaco-syntax-themes'

/** A picked syntax palette's Monaco theme; null when the default palette defers to the app/editor theme. */
export function resolveSyntaxPaletteMonacoTheme(
  editorTheme: string | undefined,
  isDark: boolean
): string | null {
  const palette = EDITOR_SYNTAX_THEME_OPTIONS.find((option) => option.id === editorTheme)
  if (!palette || palette.id === DEFAULT_EDITOR_THEME_ID) {
    return null
  }
  return resolveMonacoThemeName(palette.id, isDark)
}

/** The Monaco theme every editor surface uses: a picked syntax palette (One Dark Pro, custom) wins,
 *  else the editor or app theme's. `isDarkOverride` passes an already resolved app mode. */
export function useEditorMonacoTheme(isDarkOverride?: boolean): string {
  const appEditorTheme = useMonacoTheme(isDarkOverride)
  const editorTheme = useAppStore((s) => s.settings?.editorTheme)
  const documentDark = useDocumentDarkTheme()
  const editorBase = useCodeEditorThemeStore((state) => state.override?.base)
  const isDark = editorBase ? editorBase === 'dark' : (isDarkOverride ?? documentDark)
  return resolveSyntaxPaletteMonacoTheme(editorTheme, isDark) ?? appEditorTheme
}
