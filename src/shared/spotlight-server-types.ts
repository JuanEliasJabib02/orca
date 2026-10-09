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

/** Server commands read from a repo's package.json, plus every script worth suggesting in settings. */
export type SpotlightServerScriptDetection = {
  /** A command per environment whose script exists under exactly that name. */
  detected: SpotlightServerCommands
  /** Runnable commands for every script that looks like a server start (sorted). */
  scriptCommands: string[]
  /** Apps one server runs one at a time (`dev:<v>` scripts), sorted; absent when the repo has none.
   *  Optional so an older main's answer still parses. */
  variants?: string[]
}

export function emptySpotlightServerScriptDetection(): SpotlightServerScriptDetection {
  return { detected: {}, scriptCommands: [] }
}
