import { useMemo } from 'react'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import { useAppStore } from '../../store'
import { Input } from '../ui/input'
import { listSidebarSpaces } from '../sidebar/sidebar-space-scope'
import { translate } from '@/i18n/i18n'
import { SearchableSetting } from './SearchableSetting'
import { SettingsRow, SettingsSwitchRow } from './SettingsFormControls'
import {
  getArcSpacesSettingDescription,
  getArcSpacesSettingTitle
} from './browser-arc-spaces-search'

type BrowserArcSpacesSettingProps = {
  settings: Pick<GlobalSettings, 'openLinksInArcSpaces' | 'arcSpaceNameBySidebarSpaceId'>
  updateSettings: (updates: Partial<GlobalSettings>) => void
}

export function BrowserArcSpacesSetting({
  settings,
  updateSettings
}: BrowserArcSpacesSettingProps): React.JSX.Element {
  const projectGroups = useAppStore((s) => s.projectGroups)
  const spaces = useMemo(() => listSidebarSpaces(projectGroups), [projectGroups])
  const enabled = settings.openLinksInArcSpaces === true
  const names = settings.arcSpaceNameBySidebarSpaceId ?? {}
  const title = getArcSpacesSettingTitle()
  const description = getArcSpacesSettingDescription()

  const saveName = (spaceId: string, rawName: string): void => {
    const name = rawName.trim()
    if ((names[spaceId] ?? '') === name) {
      return
    }
    const next = Object.fromEntries(Object.entries(names).filter(([id]) => id !== spaceId))
    if (name) {
      next[spaceId] = name
    }
    updateSettings({ arcSpaceNameBySidebarSpaceId: next })
  }

  return (
    <SearchableSetting
      title={title}
      description={description}
      keywords={['browser', 'links', 'arc', 'space', 'spaces']}
    >
      <SettingsSwitchRow
        label={title}
        description={description}
        checked={enabled}
        onChange={() => updateSettings({ openLinksInArcSpaces: !enabled })}
      />
      {enabled ? (
        <div className="ml-4 border-l border-border pl-4">
          {spaces.length === 0 ? (
            <p className="py-2 text-xs text-muted-foreground">
              {translate(
                'settings.browser.arcSpaces.noSpaces',
                'Create a space in the sidebar to pick its Arc space.'
              )}
            </p>
          ) : null}
          {spaces.map((space) => (
            <SettingsRow
              key={space.id}
              label={space.name}
              control={
                <Input
                  // Why the key: re-seeds the uncontrolled field when the saved name changes elsewhere.
                  key={names[space.id] ?? ''}
                  defaultValue={names[space.id] ?? ''}
                  placeholder={translate(
                    'settings.browser.arcSpaces.placeholder',
                    'Arc space name'
                  )}
                  aria-label={translate(
                    'settings.browser.arcSpaces.fieldLabel',
                    'Arc space for {{value0}}',
                    { value0: space.name }
                  )}
                  spellCheck={false}
                  autoCapitalize="none"
                  autoCorrect="off"
                  className="h-7 w-52"
                  onBlur={(event) => saveName(space.id, event.currentTarget.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.currentTarget.blur()
                    }
                  }}
                />
              }
            />
          ))}
        </div>
      ) : null}
    </SearchableSetting>
  )
}
