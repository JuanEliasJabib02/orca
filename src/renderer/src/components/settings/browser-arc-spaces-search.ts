import type { SettingsSearchEntry } from './settings-search'
import { translate } from '@/i18n/i18n'
import { translateSearchKeyword } from './settings-search-keywords'
import { createLocalizedCatalog } from '@/i18n/localized-catalog'

export function getArcSpacesSettingTitle(): string {
  return translate('settings.browser.arcSpaces.title', 'Open Links in Arc Spaces')
}

export function getArcSpacesSettingDescription(): string {
  return translate(
    'settings.browser.arcSpaces.description',
    "Links that open in your browser go to the Arc space you pick for the workspace's space. A space without a name opens links as usual."
  )
}

export const getBrowserArcSpacesSearchEntry = createLocalizedCatalog((): SettingsSearchEntry => ({
  title: getArcSpacesSettingTitle(),
  description: getArcSpacesSettingDescription(),
  keywords: [
    ...translateSearchKeyword('auto.components.settings.browser.search.2d2d995c58', 'browser'),
    ...translateSearchKeyword('settings.browser.arcSpaces.keyword.arc', 'arc'),
    ...translateSearchKeyword('settings.browser.arcSpaces.keyword.spaces', 'spaces'),
    ...translateSearchKeyword('settings.browser.arcSpaces.keyword.links', 'links')
  ]
}))
