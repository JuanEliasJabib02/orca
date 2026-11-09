import type { EditorCustomTheme } from './editor-custom-theme'

/** Editor display settings: the Monaco syntax theme, its custom palette, and inline blame. */
export type EditorDisplaySettings = {
  /** Selectable Monaco syntax theme id (see monaco-syntax-themes.ts); missing/unknown = Monaco's built-in vs/vs-dark. */
  editorTheme?: string
  /** User-built syntax palette applied when editorTheme === 'custom'; missing roles fall back to One Dark Pro. */
  editorCustomTheme?: EditorCustomTheme
  /** End-of-line authorship on the cursor line; defaults on when unset. */
  editorInlineBlameEnabled?: boolean
}
