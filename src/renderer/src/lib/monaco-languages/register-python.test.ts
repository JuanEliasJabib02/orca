import { describe, expect, it, vi } from 'vitest'
import {
  loadPythonTextMateGrammar,
  PYTHON_LANGUAGE_ID,
  PYTHON_TEXTMATE_SCOPE,
  registerPythonLanguage
} from './register-python'

describe('registerPythonLanguage', () => {
  it('installs the TextMate tokens provider even though Monaco pre-registers python', () => {
    // Why: monaco-editor registers `python` with an eager Monarch factory at import;
    // the TextMate provider must still override it, or highlighting silently no-ops.
    const monaco = {
      languages: {
        getLanguages: vi.fn(() => [{ id: PYTHON_LANGUAGE_ID }]),
        register: vi.fn(),
        setLanguageConfiguration: vi.fn(),
        registerTokensProviderFactory: vi.fn(() => ({ dispose: vi.fn() }))
      }
    }

    registerPythonLanguage(monaco as never)

    expect(monaco.languages.register).not.toHaveBeenCalled()
    expect(monaco.languages.registerTokensProviderFactory).toHaveBeenCalledWith(
      PYTHON_LANGUAGE_ID,
      expect.objectContaining({ create: expect.any(Function) })
    )
  })
})

describe('loadPythonTextMateGrammar', () => {
  it('loads the MagicPython grammar for its scope', async () => {
    const grammar = await loadPythonTextMateGrammar(PYTHON_TEXTMATE_SCOPE)
    expect(grammar).not.toBeNull()
    expect((grammar as { scopeName?: string } | null)?.scopeName).toBe(PYTHON_TEXTMATE_SCOPE)
  })

  it('returns null for any other scope', async () => {
    expect(await loadPythonTextMateGrammar('source.nim')).toBeNull()
  })
})
