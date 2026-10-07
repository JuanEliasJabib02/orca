import { useEffect, useId, useState } from 'react'
import type { Repo } from '../../../../shared/repo-types'
import {
  resolveSpotlightServerCommand,
  sanitizeSpotlightServerConfig
} from '../../../../shared/spotlight-server-command'
import {
  emptySpotlightServerScriptDetection,
  SPOTLIGHT_SERVER_ENVS,
  type SpotlightServerCommands,
  type SpotlightServerConfig,
  type SpotlightServerEnv,
  type SpotlightServerScriptDetection
} from '../../../../shared/spotlight-server-types'
import { translate } from '@/i18n/i18n'
import { Input } from '../ui/input'
import { NumberField, SettingsRow } from './SettingsFormControls'

const MAX_PORT = 65535

type RepositorySpotlightServerFieldsProps = {
  repo: Repo
  updateRepo: (repoId: string, updates: { spotlightServer: SpotlightServerConfig | null }) => void
}

type DetectionState = { repoId: string; detection: SpotlightServerScriptDetection }

// Why: a field's placeholder is what runs when it is left empty, so its own saved value is left out.
function commandsExcluding(
  config: SpotlightServerConfig | undefined,
  env: SpotlightServerEnv
): SpotlightServerCommands {
  const commands: SpotlightServerCommands = {}
  for (const other of SPOTLIGHT_SERVER_ENVS) {
    const command = config?.[other]
    if (other !== env && command) {
      commands[other] = command
    }
  }
  return commands
}

function SpotlightServerCommandInput({
  label,
  value,
  placeholder,
  suggestionsId,
  onCommit
}: {
  label: string
  value: string
  placeholder: string
  suggestionsId: string
  onCommit: (command: string) => void
}): React.JSX.Element {
  const [draft, setDraft] = useState(value)
  const [saved, setSaved] = useState(value)
  const [prevValue, setPrevValue] = useState(value)

  // Pick up stored changes (including the echo of our own save).
  if (value !== prevValue) {
    setPrevValue(value)
    setSaved(value)
    setDraft(value)
  }

  const commit = (): void => {
    const next = draft.trim()
    setDraft(next)
    // Why: Enter then blur would otherwise save the same text twice before the store echoes it back.
    if (next !== saved) {
      setSaved(next)
      onCommit(next)
    }
  }

  return (
    <Input
      type="text"
      list={suggestionsId}
      aria-label={label}
      value={draft}
      placeholder={placeholder}
      spellCheck={false}
      autoComplete="off"
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
          commit()
        }
      }}
      className="w-80 font-mono text-xs"
    />
  )
}

export function RepositorySpotlightServerFields({
  repo,
  updateRepo
}: RepositorySpotlightServerFieldsProps): React.JSX.Element {
  const [detectionState, setDetectionState] = useState<DetectionState | null>(null)
  const suggestionsId = useId()
  const saved = repo.spotlightServer
  const detection = detectionState?.repoId === repo.id ? detectionState.detection : null

  useEffect(() => {
    let cancelled = false
    const settle = (result: SpotlightServerScriptDetection): void => {
      if (!cancelled) {
        setDetectionState({ repoId: repo.id, detection: result })
      }
    }
    window.api.repos
      .detectSpotlightServerScripts({ repoId: repo.id })
      .then(settle)
      .catch(() => settle(emptySpotlightServerScriptDetection()))
    return () => {
      cancelled = true
    }
  }, [repo.id])

  const persist = (next: SpotlightServerConfig): void => {
    updateRepo(repo.id, { spotlightServer: sanitizeSpotlightServerConfig(next) ?? null })
  }
  const saveCommand = (env: SpotlightServerEnv, command: string): void => {
    const next: SpotlightServerConfig = { ...saved }
    next[env] = command
    persist(next)
  }
  const savePort = (port: number | undefined): void => {
    // Why: the number field commits on every blur, even when nothing changed.
    if (port !== saved?.port) {
      persist({ ...saved, port })
    }
  }

  const notStarted = translate(
    'auto.components.settings.RepositorySpotlightSection.notStarted',
    'Not started'
  )
  const envLabels: Record<SpotlightServerEnv, string> = {
    local: translate('auto.components.settings.RepositorySpotlightSection.localLabel', 'Local'),
    dev: translate('auto.components.settings.RepositorySpotlightSection.devLabel', 'Dev'),
    prod: translate('auto.components.settings.RepositorySpotlightSection.prodLabel', 'Prod')
  }
  const placeholderFor = (env: SpotlightServerEnv): string => {
    // Why: an empty placeholder while detecting avoids flashing "Not started" for a script that exists.
    if (!detection) {
      return ''
    }
    return (
      resolveSpotlightServerCommand({
        config: commandsExcluding(saved, env),
        detected: detection.detected,
        env
      }) ?? notStarted
    )
  }

  return (
    <div className="space-y-2">
      <div className="space-y-1">
        <h4 className="text-sm font-semibold">
          {translate('auto.components.settings.RepositorySpotlightSection.serverTitle', 'Server')}
        </h4>
        <p className="text-xs text-muted-foreground">
          {translate(
            'auto.components.settings.RepositorySpotlightSection.serverDescription',
            'Orca starts this command in the Spotlight terminal when Spotlight turns on and appends --port N. An empty field uses the script detected in package.json. Local falls back to Dev.'
          )}
        </p>
      </div>
      <datalist id={suggestionsId}>
        {detection?.scriptCommands.map((command) => (
          <option key={command} value={command} />
        ))}
      </datalist>
      {SPOTLIGHT_SERVER_ENVS.map((env) => (
        <SettingsRow
          key={env}
          label={envLabels[env]}
          control={
            <SpotlightServerCommandInput
              label={envLabels[env]}
              value={saved?.[env] ?? ''}
              placeholder={placeholderFor(env)}
              suggestionsId={suggestionsId}
              onCommit={(command) => saveCommand(env, command)}
            />
          }
        />
      ))}
      <NumberField
        label={translate('auto.components.settings.RepositorySpotlightSection.portLabel', 'Port')}
        description={translate(
          'auto.components.settings.RepositorySpotlightSection.portDescription',
          'Appended to the command as --port N. Leave empty to keep the command’s own port.'
        )}
        value={saved?.port}
        min={1}
        max={MAX_PORT}
        integer
        placeholder={translate(
          'auto.components.settings.RepositorySpotlightSection.portPlaceholder',
          'Command default'
        )}
        onChange={savePort}
        onClear={() => savePort(undefined)}
      />
    </div>
  )
}
