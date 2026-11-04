import type * as Monaco from 'monaco-editor'
import type { LanguageRegistration } from 'shiki/core'
import { registerTextMateLanguage } from './textmate-language-registration'

type MonacoModule = typeof Monaco

export const PYTHON_LANGUAGE_ID = 'python'

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

export async function loadPythonTextMateGrammar(): Promise<LanguageRegistration> {
  // Why: MagicPython, the same TextMate grammar VS Code / Cursor use, so Python
  // highlights identically for reading (see textmate-grammars/python-LICENSE.txt).
  const grammarModule = await import('./textmate-grammars/python.tmLanguage.json')
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: TextMate injects the $self/$base repository entries a registration's type requires; real tokenization tests validate this vendored JSON.
  const grammar = grammarModule.default as unknown as LanguageRegistration
  return { ...grammar, name: PYTHON_LANGUAGE_ID }
}

export function registerPythonLanguage(monaco: MonacoModule): void {
  registerTextMateLanguage(monaco, {
    language: {
      id: PYTHON_LANGUAGE_ID,
      extensions: ['.py', '.pyw', '.pyi', '.rpy', '.gyp', '.gypi'],
      aliases: ['Python', 'py']
    },
    configuration: pythonLanguageConfiguration,
    loadGrammar: loadPythonTextMateGrammar
  })
}
