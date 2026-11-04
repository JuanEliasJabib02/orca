import { defineFixture } from '../../../component-fixtures/component-fixture'
import { getDefaultSettings } from '../../../../../shared/constants'
import { SpotlightTestQueueSettings } from './SpotlightTestQueueSettings'

const settings = getDefaultSettings('/home/fixture')

export const defaults = defineFixture({
  width: 720,
  render: () => <SpotlightTestQueueSettings settings={settings} updateSettings={() => {}} />
})

export const fourAtOnceAutoResumeOn = defineFixture({
  width: 720,
  render: () => (
    <SpotlightTestQueueSettings
      settings={{
        ...settings,
        spotlightMaxConcurrentTests: 4,
        spotlightAutoResumeAfterUsageLimit: true
      }}
      updateSettings={() => {}}
    />
  )
})
