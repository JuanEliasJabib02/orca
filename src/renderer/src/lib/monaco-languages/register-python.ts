import type * as Monaco from 'monaco-editor'
import type { IRawGrammar } from 'vscode-textmate'
import { registerTextMateLanguage } from './textmate-language-registration'

type MonacoModule = typeof Monaco

export const PYTHON_LANGUAGE_ID = 'python'
export const PYTHON_TEXTMATE_SCOPE = 'source.python'

export const pythonLanguageConfiguration: Monaco.languages.LanguageConfiguration = {
  comments: {
    lineComment: '#'
  },
  brackets: [
    ['{', '}'],
    ['[', ']'],
    ['(', ')']
  ],
  autoClosingPairs: [
    { open: '{', close: '}' },
    { open: '[', close: ']' },
    { open: '(', close: ')' },
    { open: '"', close: '"', notIn: ['string'] },
    { open: "'", close: "'", notIn: ['string', 'comment'] }
  ],
  surroundingPairs: [
    { open: '{', close: '}' },
    { open: '[', close: ']' },
    { open: '(', close: ')' },
    { open: '"', close: '"' },
    { open: "'", close: "'" }
  ]
}

export async function loadPythonTextMateGrammar(scopeName: string): Promise<IRawGrammar | null> {
  if (scopeName !== PYTHON_TEXTMATE_SCOPE) {
    return null
  }

  // Why: MagicPython, the same TextMate grammar VS Code / Cursor use, so Python
  // highlights identically for reading (see textmate-grammars/python-LICENSE.txt).
  const grammarModule = await import('./textmate-grammars/python.tmLanguage.json')
  return grammarModule.default as unknown as IRawGrammar
}

export function registerPythonLanguage(monaco: MonacoModule): void {
  registerTextMateLanguage(monaco, {
    language: {
      id: PYTHON_LANGUAGE_ID,
      extensions: ['.py', '.pyw', '.pyi', '.rpy', '.gyp', '.gypi'],
      aliases: ['Python', 'py']
    },
    configuration: pythonLanguageConfiguration,
    scopeName: PYTHON_TEXTMATE_SCOPE,
    loadGrammar: loadPythonTextMateGrammar
  })
}
