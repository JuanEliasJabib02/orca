import type { Repo } from '../../../../shared/repo-types'
import type { SettingsSearchEntry } from './settings-search'
import { translate } from '@/i18n/i18n'
import { translateSearchKeyword } from './settings-search-keywords'

export function getRepositorySpotlightServerSearchEntry(repo: Repo): SettingsSearchEntry {
  return {
    title: translate(
      'auto.components.settings.repository.search.spotlightServer',
      'Spotlight Server'
    ),
    description: translate(
      'auto.components.settings.repository.search.spotlightServerDescription',
      'Commands and port that start this project’s server in the Spotlight terminal.'
    ),
    keywords: [
      repo.displayName,
      ...translateSearchKeyword(
        'auto.components.settings.repository.search.spotlight',
        'spotlight'
      ),
      ...translateSearchKeyword('auto.components.settings.repository.search.server', 'server'),
      ...translateSearchKeyword(
        'auto.components.settings.repository.search.devServer',
        'dev server'
      ),
      ...translateSearchKeyword('auto.components.settings.repository.search.command', 'command'),
      ...translateSearchKeyword('auto.components.settings.repository.search.port', 'port'),
      ...translateSearchKeyword('auto.components.settings.repository.search.0432d2fb7c', 'local'),
      ...translateSearchKeyword('auto.components.settings.repository.search.dev', 'dev'),
      ...translateSearchKeyword('auto.components.settings.repository.search.prod', 'prod')
    ]
  }
}

// Why: both entries belong to the one Spotlight section, so either one keeps it visible in search.
export function isRepositorySpotlightSearchEntry(entry: SettingsSearchEntry): boolean {
  return (
    entry.title ===
      translate(
        'auto.components.settings.repository.search.spotlightTesting',
        'Spotlight Testing'
      ) ||
    entry.title ===
      translate('auto.components.settings.repository.search.spotlightServer', 'Spotlight Server')
  )
}
