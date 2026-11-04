import { Minus, Plus } from 'lucide-react'
import type { GlobalSettings } from '../../../../../shared/global-settings-types'
import {
  DEFAULT_SPOTLIGHT_AUTO_RESUME_AFTER_USAGE_LIMIT,
  MAX_SPOTLIGHT_MAX_CONCURRENT_TESTS,
  MIN_SPOTLIGHT_MAX_CONCURRENT_TESTS,
  normalizeSpotlightMaxConcurrentTests
} from '../../../../../shared/spotlight-test-queue-settings'
import { Button } from '../../ui/button'
import { Input } from '../../ui/input'
import { SettingsRow, SettingsSwitchRow } from '../form-controls/SettingsFormControls'
import { SearchableSetting } from '../section-layout/SearchableSetting'
import { getSpotlightTestQueueSearchEntries } from './terminal-search'
import { isWebClientLocation } from '@/lib/web-client-location'
import { translate } from '@/i18n/i18n'

type SpotlightTestQueueSettingsProps = {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
}

export function SpotlightTestQueueSettings({
  settings,
  updateSettings
}: SpotlightTestQueueSettingsProps): React.JSX.Element | null {
  // Why: the queue lives in the desktop host; a web client's copy of these would change nothing.
  if (isWebClientLocation()) {
    return null
  }
  const [maxTestsSearchEntry, autoResumeSearchEntry] = getSpotlightTestQueueSearchEntries()
  const maxTests = normalizeSpotlightMaxConcurrentTests(settings.spotlightMaxConcurrentTests)
  const autoResume =
    settings.spotlightAutoResumeAfterUsageLimit ?? DEFAULT_SPOTLIGHT_AUTO_RESUME_AFTER_USAGE_LIMIT
  const writeMaxTests = (value: number): void => {
    const next = normalizeSpotlightMaxConcurrentTests(value)
    if (next !== settings.spotlightMaxConcurrentTests) {
      updateSettings({ spotlightMaxConcurrentTests: next })
    }
  }
  const maxTestsLabel = translate(
    'components.settings.SpotlightTestQueue.maxConcurrentTests',
    'Tasks Testing at Once'
  )
  const autoResumeLabel = translate(
    'components.settings.SpotlightTestQueue.autoResume',
    'Resume After a Usage Limit'
  )

  return (
    <>
      <SearchableSetting {...maxTestsSearchEntry}>
        <SettingsRow
          label={maxTestsLabel}
          description={translate(
            'components.settings.SpotlightTestQueue.maxConcurrentTestsDescription',
            'How many tasks can run Playwright or Maestro at the same time, one per space. The rest wait in line.'
          )}
          control={
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="icon-sm"
                aria-label={translate(
                  'components.settings.SpotlightTestQueue.fewerTasks',
                  'One fewer task'
                )}
                onClick={() => writeMaxTests(maxTests - 1)}
                disabled={maxTests <= MIN_SPOTLIGHT_MAX_CONCURRENT_TESTS}
              >
                <Minus className="size-3" />
              </Button>
              <Input
                type="number"
                min={MIN_SPOTLIGHT_MAX_CONCURRENT_TESTS}
                max={MAX_SPOTLIGHT_MAX_CONCURRENT_TESTS}
                aria-label={maxTestsLabel}
                value={maxTests}
                onChange={(e) => {
                  const value = Number.parseInt(e.target.value, 10)
                  if (!Number.isNaN(value)) {
                    writeMaxTests(value)
                  }
                }}
                className="number-input-clean w-14 text-center tabular-nums"
              />
              <Button
                variant="outline"
                size="icon-sm"
                aria-label={translate(
                  'components.settings.SpotlightTestQueue.moreTasks',
                  'One more task'
                )}
                onClick={() => writeMaxTests(maxTests + 1)}
                disabled={maxTests >= MAX_SPOTLIGHT_MAX_CONCURRENT_TESTS}
              >
                <Plus className="size-3" />
              </Button>
            </div>
          }
        />
      </SearchableSetting>

      <SearchableSetting {...autoResumeSearchEntry}>
        <SettingsSwitchRow
          label={autoResumeLabel}
          description={translate(
            'components.settings.SpotlightTestQueue.autoResumeDescription',
            'When a testing task stops at its Claude usage limit, continue it with an account that has limit left. Up to 3 times in a row, then it waits for you.'
          )}
          checked={autoResume}
          onChange={() => updateSettings({ spotlightAutoResumeAfterUsageLimit: !autoResume })}
        />
      </SearchableSetting>
    </>
  )
}
