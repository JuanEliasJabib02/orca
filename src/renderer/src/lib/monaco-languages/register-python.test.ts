import { describe, expect, it, vi } from 'vitest'
import {
  loadPythonTextMateGrammar,
  PYTHON_LANGUAGE_ID,
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
    // Why: Monaco's own python configuration is richer than ours, so it must survive.
    expect(monaco.languages.setLanguageConfiguration).not.toHaveBeenCalled()
    expect(monaco.languages.registerTokensProviderFactory).toHaveBeenCalledWith(
      PYTHON_LANGUAGE_ID,
      expect.objectContaining({ create: expect.any(Function) })
    )
  })
})

describe('loadPythonTextMateGrammar', () => {
  it('names the MagicPython grammar after the Monaco language id', async () => {
    const grammar = await loadPythonTextMateGrammar()
    expect(grammar.scopeName).toBe('source.python')
    expect(grammar.name).toBe('python')
  })
})
