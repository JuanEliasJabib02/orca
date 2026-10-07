import { translate } from '@/i18n/i18n'
import type { SpotlightServerEnv } from '../../../../shared/spotlight-server-types'

export function getSpotlightEnvLabel(env: SpotlightServerEnv): string {
  switch (env) {
    case 'dev':
      return translate('auto.components.sidebar.SpotlightEnv.dev', 'Dev')
    case 'prod':
      return translate('auto.components.sidebar.SpotlightEnv.prod', 'Prod')
    case 'local':
      return translate('auto.components.sidebar.SpotlightEnv.local', 'Local')
  }
}
