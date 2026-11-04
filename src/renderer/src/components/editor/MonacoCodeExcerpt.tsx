import React, { useEffect, useMemo, useState } from 'react'
import { monaco } from '@/lib/monaco-setup'
import { EDITOR_TYPOGRAPHY_SURFACE_CLASS, editorTypographyTextStyle } from '@/lib/editor-typography'
import { useEditorTypography } from '@/hooks/use-editor-typography'
import { cn } from '@/lib/utils'
import { useEditorMonacoTheme } from '@/hooks/use-editor-monaco-theme'

/** Monaco token HTML per line, colored with the user's selected syntax theme. */
export function useMonacoColorizedLines(lines: string[], language: string): string[] {
  const monacoTheme = useEditorMonacoTheme()
  const code = useMemo(() => lines.join('\n'), [lines])
  const lineCount = lines.length
  const [htmlLines, setHtmlLines] = useState<string[]>(() => lines.map(() => ''))

  useEffect(() => {
    monaco.editor.setTheme(monacoTheme)
  }, [monacoTheme])

  // Why: colorize emits theme-specific token classes, so a theme switch must re-colorize.
  useEffect(() => {
    if (lineCount === 0) {
      setHtmlLines([])
      return
    }

    let cancelled = false
    // Why: colorize() resolves the language's registered tokenizer factory
    // (TextMate for Python, Monarch for the rest) before returning HTML.
    void monaco.editor.colorize(code, language, { tabSize: 2 }).then((html) => {
      if (cancelled) {
        return
      }
      const nextLines = html.split('<br/>').slice(0, lineCount)
      setHtmlLines(nextLines)
    })

    return () => {
      cancelled = true
    }
  }, [code, language, lineCount, monacoTheme])

  return htmlLines
}

type MonacoCodeExcerptProps = {
  lines: string[]
  firstLineNumber: number
  highlightedStartLine: number
  highlightedEndLine: number
  language: string
}

export default function MonacoCodeExcerpt({
  lines,
  firstLineNumber,
  highlightedStartLine,
  highlightedEndLine,
  language
}: MonacoCodeExcerptProps): React.JSX.Element {
  const typography = useEditorTypography()
  const htmlLines = useMonacoColorizedLines(lines, language)

  return (
    <div
      className={cn(
        'code-editor-colors overflow-x-auto py-1 text-[12px] leading-5',
        EDITOR_TYPOGRAPHY_SURFACE_CLASS
      )}
      style={editorTypographyTextStyle(typography)}
    >
      {lines.map((codeLine, index) => {
        const lineNumber = firstLineNumber + index
        const isCommentedLine =
          lineNumber >= highlightedStartLine && lineNumber <= highlightedEndLine
        const html = htmlLines[index] || (codeLine ? undefined : '&nbsp;')
        return (
          <div key={lineNumber} className={cn('flex', isCommentedLine && 'bg-ring/15')}>
            <span className="w-12 shrink-0 select-none border-r border-border/40 px-2 text-right text-muted-foreground tabular-nums">
              {lineNumber}
            </span>
            {html ? (
              <code
                className="min-w-max flex-1 whitespace-pre px-3 text-foreground"
                dangerouslySetInnerHTML={{ __html: html }}
              />
            ) : (
              <code className="min-w-max flex-1 whitespace-pre px-3 text-foreground">
                {codeLine || ' '}
              </code>
            )}
          </div>
        )
      })}
    </div>
  )
}
