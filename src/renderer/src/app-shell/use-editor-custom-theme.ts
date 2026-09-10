import { useEffect, useMemo } from 'react'
import { useAppStore } from '@/store'
import { monaco } from '@/lib/monaco-setup'
import {
  applyCustomMonacoTheme,
  CUSTOM_EDITOR_THEME_ID,
  CUSTOM_MONACO_THEME_NAME
} from '@/lib/monaco-syntax-themes'
import { normalizeEditorCustomTheme } from '../../../shared/editor-custom-theme'

// Keeps the global 'orca-custom' Monaco theme in sync with the user's palette.
// Monaco themes are global, so one definition drives every editor surface.
export function useEditorCustomTheme(): void {
  const editorTheme = useAppStore((s) => s.settings?.editorTheme)
  const editorCustomTheme = useAppStore((s) => s.settings?.editorCustomTheme)
  // Normalize once per palette change (App re-renders often, the palette rarely).
  const colors = useMemo(() => normalizeEditorCustomTheme(editorCustomTheme), [editorCustomTheme])

  useEffect(() => {
    applyCustomMonacoTheme(monaco, colors)
    // Redefining a theme does not repaint mounted editors; re-apply when active.
    if (editorTheme === CUSTOM_EDITOR_THEME_ID) {
      monaco.editor.setTheme(CUSTOM_MONACO_THEME_NAME)
    }
  }, [colors, editorTheme])
}
