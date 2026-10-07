/** Which backend a Spotlight's fronts run against; picks the per-repo server command. */
export type SpotlightServerEnv = 'local' | 'dev' | 'prod'

export const SPOTLIGHT_SERVER_ENVS: readonly SpotlightServerEnv[] = ['local', 'dev', 'prod']

export const DEFAULT_SPOTLIGHT_SERVER_ENV: SpotlightServerEnv = 'local'

/** Server commands per environment, as detected from package.json or typed by the user. */
export type SpotlightServerCommands = Partial<Record<SpotlightServerEnv, string>>

/** Per-repo server settings stored in Orca (never in the repo). `port` is appended as `--port N`. */
export type SpotlightServerConfig = SpotlightServerCommands & {
  port?: number
}

export function isSpotlightServerEnv(value: unknown): value is SpotlightServerEnv {
  return value === 'local' || value === 'dev' || value === 'prod'
}
