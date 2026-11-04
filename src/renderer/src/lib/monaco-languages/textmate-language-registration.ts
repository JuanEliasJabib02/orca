import type * as Monaco from 'monaco-editor'
import type {
  createTextMateTokensProvider as createTextMateTokensProviderType,
  TextMateGrammarLoader
} from './textmate-token-provider'

type MonacoModule = Pick<typeof Monaco, 'languages'>
type TextMateTokensProvider = Monaco.languages.TokensProvider
type TextMateTokenProviderModule = {
  createTextMateTokensProvider: typeof createTextMateTokensProviderType
}

export type TextMateLanguageRegistration = {
  language: Monaco.languages.ILanguageExtensionPoint
  configuration?: Monaco.languages.LanguageConfiguration
  loadGrammar: TextMateGrammarLoader
  mapTokenScopes?: (scopes: readonly string[]) => string
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
      // Basic tokenization never fires rich-feature onLanguage; load read-only Nim through basic language features.
      tokensProviderPromise ??= (
        registration.loadProviderModule ?? loadDefaultProviderModule
      )().then(({ createTextMateTokensProvider }) =>
        createTextMateTokensProvider({
          loadGrammar: registration.loadGrammar,
          ...(registration.mapTokenScopes ? { mapTokenScopes: registration.mapTokenScopes } : {})
        })
      )
      return tokensProviderPromise
    }
  })
}
