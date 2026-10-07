import {
  SPOTLIGHT_SERVER_ENVS,
  type SpotlightServerCommands,
  type SpotlightServerConfig,
  type SpotlightServerEnv
} from './spotlight-server-types'

const MAX_SPOTLIGHT_SERVER_COMMAND_LENGTH = 2000

function normalizeCommand(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function normalizePort(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 65535
    ? value
    : undefined
}

/** Guard for IPC/persistence: keeps only valid commands and port, `undefined` when nothing is left. */
export function sanitizeSpotlightServerConfig(value: unknown): SpotlightServerConfig | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined
  }
  const config: SpotlightServerConfig = {}
  for (const env of SPOTLIGHT_SERVER_ENVS) {
    const command = normalizeCommand(Reflect.get(value, env))
    // Why: truncating would run half a shell command, so an over-long one is dropped instead.
    if (command !== undefined && command.length <= MAX_SPOTLIGHT_SERVER_COMMAND_LENGTH) {
      config[env] = command
    }
  }
  const port = normalizePort(Reflect.get(value, 'port'))
  if (port !== undefined) {
    config.port = port
  }
  return Object.keys(config).length > 0 ? config : undefined
}

/** `updateRepo` patch value: `null` clears the stored config, `undefined` leaves it untouched. */
export function normalizeSpotlightServerUpdate(
  value: unknown
): SpotlightServerConfig | null | undefined {
  if (value === null) {
    return null
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    return undefined
  }
  return sanitizeSpotlightServerConfig(value) ?? null
}

function pickCommand(
  env: SpotlightServerEnv,
  config: SpotlightServerConfig | undefined,
  detected: SpotlightServerCommands | undefined
): string | undefined {
  return normalizeCommand(config?.[env]) ?? normalizeCommand(detected?.[env])
}

/** The command that starts a repo's Spotlight server in `env`, or null when it isn't started there. */
export function resolveSpotlightServerCommand(args: {
  config?: SpotlightServerConfig
  detected?: SpotlightServerCommands
  env: SpotlightServerEnv
}): string | null {
  const { config, detected, env } = args
  // Why: some repos (e.g. landing) have no Local script and run their Dev one locally.
  const command =
    pickCommand(env, config, detected) ??
    (env === 'local' ? pickCommand('dev', config, detected) : undefined)
  if (!command) {
    return null
  }
  const port = normalizePort(config?.port)
  return port === undefined ? command : `${command} --port ${port}`
}
