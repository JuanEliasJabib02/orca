import type * as Monaco from 'monaco-editor'
import type {
  createTextMateTokensProvider as createTextMateTokensProviderType,
  TextMateGrammarLoader
} from './textmate-token-provider'

type MonacoModule = typeof Monaco
type TextMateTokensProvider = Monaco.languages.TokensProvider
type TextMateTokenProviderModule = {
  createTextMateTokensProvider: typeof createTextMateTokensProviderType
}

export type TextMateLanguageRegistration = {
  language: Monaco.languages.ILanguageExtensionPoint
  configuration?: Monaco.languages.LanguageConfiguration
  scopeName: string
  loadGrammar: TextMateGrammarLoader
  loadProviderModule?: () => Promise<TextMateTokenProviderModule>
}

function loadDefaultProviderModule(): Promise<TextMateTokenProviderModule> {
  return import('./textmate-token-provider')
}

export function registerTextMateLanguage(
  monaco: MonacoModule,
  registration: TextMateLanguageRegistration
): void {
  const languageAlreadyRegistered = monaco.languages
    .getLanguages()
    .some((language) => language.id === registration.language.id)

  // Why: a Monaco basic language (e.g. python) may already own the id with an
  // eager Monarch tokens factory. Register metadata/config only when the id is
  // new — so we keep Monaco's richer built-in configuration — but ALWAYS install
  // the TextMate tokens provider, since registerTokensProviderFactory replaces
  // any prior factory (and nothing re-installs Monarch afterward).
  if (!languageAlreadyRegistered) {
    monaco.languages.register(registration.language)
    if (registration.configuration) {
      monaco.languages.setLanguageConfiguration(
        registration.language.id,
        registration.configuration
      )
    }
  }

  let tokensProviderPromise: Promise<TextMateTokensProvider> | undefined
  monaco.languages.registerTokensProviderFactory(registration.language.id, {
    create: () => {
      // Why: plain Monaco tokenization requests basic language features; onLanguage
      // only fires for rich features, so it never loads for a read-only Nim editor.
      tokensProviderPromise ??= (
        registration.loadProviderModule ?? loadDefaultProviderModule
      )().then(({ createTextMateTokensProvider }) =>
        createTextMateTokensProvider({
          scopeName: registration.scopeName,
          loadGrammar: registration.loadGrammar
        })
      )
      return tokensProviderPromise
    }
  })
}
