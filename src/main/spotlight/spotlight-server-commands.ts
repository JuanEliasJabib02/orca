// Last server command Orca ran per repo. Outlives the Spotlight terminal's PTY (a respawn
// registers a new capture) and is forgotten when Spotlight turns off. Its own module so the
// log mirror's restart trigger can read it without importing server control (import cycle).
import { takeSpotlightLaunchLine } from './spotlight-lockfile-install'
import { getSpotlightTerminalShell } from './spotlight-terminal-shell'

/** A line queued as the Spotlight terminal's startup command that no shell has run yet. */
export type PreparedSpotlightLaunch = { command: string; installTaken: boolean }

type PreparedLaunchRecord = PreparedSpotlightLaunch & {
  preparedAt: number
  /** When a PTY registered as the Spotlight terminal, i.e. the queued line got a shell to run in. */
  registeredAt?: number
}

const commandByRepoId = new Map<string, string>()
// Why separate: a busy start remembers its command for restarts without having typed it.
const launchedByRepoId = new Map<string, string>()
const typedAtByRepoId = new Map<string, number>()
const preparedByRepoId = new Map<string, PreparedLaunchRecord>()

export function rememberSpotlightServerCommand(repoId: string, command: string): void {
  commandByRepoId.set(repoId, command)
}

export function getSpotlightServerCommand(repoId: string): string | undefined {
  return commandByRepoId.get(repoId)
}

/** Orca queued `command` as the Spotlight terminal's startup command. */
export function markSpotlightServerLaunched(repoId: string, command: string): void {
  launchedByRepoId.set(repoId, command)
}

/** Orca typed `command` into the Spotlight terminal just now, superseding a queued launch. */
export function markSpotlightServerTyped(repoId: string, command: string): void {
  launchedByRepoId.set(repoId, command)
  typedAtByRepoId.set(repoId, Date.now())
  preparedByRepoId.delete(repoId)
}

/** Orca typed a line less than `ms` ago, which the shell may not have forked yet. */
export function isSpotlightServerTypedWithin(repoId: string, ms: number): boolean {
  const typedAt = typedAtByRepoId.get(repoId)
  return typedAt !== undefined && Date.now() - typedAt < ms
}

/** The command Orca itself last ran there; undefined means a running server was started by hand. */
export function getSpotlightServerLaunchedCommand(repoId: string): string | undefined {
  return launchedByRepoId.get(repoId)
}

export function clearSpotlightServerLaunched(repoId: string): void {
  launchedByRepoId.delete(repoId)
}

export function rememberPreparedSpotlightLaunch(
  repoId: string,
  prepared: PreparedSpotlightLaunch
): void {
  preparedByRepoId.set(repoId, { ...prepared, preparedAt: Date.now() })
}

/** A PTY registered as the repo's Spotlight terminal: a queued line now has a shell to run in. */
export function markPreparedSpotlightLaunchRegistered(repoId: string): void {
  const prepared = preparedByRepoId.get(repoId)
  if (prepared && prepared.registeredAt === undefined) {
    prepared.registeredAt = Date.now()
  }
}

/** A queued line may still be on its way into the shell: no PTY registered for it yet (for at most
 *  `maxWaitMs`), or one registered less than `graceMs` ago. */
export function isPreparedSpotlightLaunchStarting(
  repoId: string,
  graceMs: number,
  maxWaitMs: number
): boolean {
  const prepared = preparedByRepoId.get(repoId)
  if (!prepared) {
    return false
  }
  return prepared.registeredAt === undefined
    ? Date.now() - prepared.preparedAt < maxWaitMs
    : Date.now() - prepared.registeredAt < graceMs
}

export function takePreparedSpotlightLaunch(repoId: string): PreparedSpotlightLaunch | undefined {
  const prepared = preparedByRepoId.get(repoId)
  preparedByRepoId.delete(repoId)
  return prepared
}

/** What a restart re-runs, with a pending install first. Without a stored command the restart
 *  recalls history instead, which leaves the install pending for Orca's next command. */
export function takeSpotlightServerRerunCommand(repoId: string): string | undefined {
  // History recall types a line too.
  typedAtByRepoId.set(repoId, Date.now())
  const command = commandByRepoId.get(repoId)
  if (!command) {
    return undefined
  }
  markSpotlightServerTyped(repoId, command)
  return takeSpotlightLaunchLine(repoId, command, getSpotlightTerminalShell(repoId))
}

export function forgetSpotlightServerCommand(repoId: string): void {
  commandByRepoId.delete(repoId)
  launchedByRepoId.delete(repoId)
  typedAtByRepoId.delete(repoId)
  preparedByRepoId.delete(repoId)
}
