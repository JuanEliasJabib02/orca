// Last server command Orca ran per repo. Outlives the Spotlight terminal's PTY (a respawn
// registers a new capture) and is forgotten when Spotlight turns off. Its own module so the
// log mirror's restart trigger can read it without importing server control (import cycle).
import { takeSpotlightLaunchLine, type SpotlightInstaller } from './spotlight-lockfile-install'
import { getSpotlightTerminalShell } from './spotlight-terminal-shell'

/** A line queued as the Spotlight terminal's startup command that no shell has run yet, and the
 *  pending installs it took (handed back if it never runs). */
export type PreparedSpotlightLaunch = { command: string; installsTaken: SpotlightInstaller[] }

type PreparedLaunchRecord = PreparedSpotlightLaunch & {
  preparedAt: number
  /** The exact text queued (the command with any install first), once it is known. */
  line?: string
  /** When a PTY registered as the Spotlight terminal, i.e. the queued line got a shell to run in. */
  registeredAt?: number
  /** When the current unbroken run of busy readings of that terminal began. */
  busySince?: number
  /** Busy readings of that terminal persisted long enough to show the queued line running. */
  ran?: boolean
}

/** Where a queued line stands: no PTY yet, one registered less than the grace ago, or registered
 *  but never seen running (it may still wait behind a slow shell's startup). */
export type PreparedSpotlightLaunchPhase = 'unregistered' | 'settling' | 'pending'

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

/** The text queued for `command`, for the log notes about it; ignored once another launch replaced it. */
export function setPreparedSpotlightLaunchLine(
  repoId: string,
  command: string,
  line: string
): void {
  const prepared = preparedByRepoId.get(repoId)
  if (prepared?.command === command) {
    prepared.line = line
  }
}

/** The queued line the log notes quote: its exact text, else its command; undefined without one. */
export function getPreparedSpotlightLaunchLine(repoId: string): string | undefined {
  const prepared = preparedByRepoId.get(repoId)
  return prepared ? (prepared.line ?? prepared.command) : undefined
}

/** A PTY registered as the repo's Spotlight terminal: a queued line now has a shell to run in.
 *  True when this registration is the one that line waited for. */
export function markPreparedSpotlightLaunchRegistered(repoId: string): boolean {
  const prepared = preparedByRepoId.get(repoId)
  if (!prepared || prepared.registeredAt !== undefined) {
    return false
  }
  prepared.registeredAt = Date.now()
  return true
}

/** The phase of a queued line that may still be on its way into the shell, for at most `maxWaitMs`
 *  after it was prepared; null once it ran, was taken back, or that cap passed. */
export function getPreparedSpotlightLaunchPhase(
  repoId: string,
  graceMs: number,
  maxWaitMs: number
): PreparedSpotlightLaunchPhase | null {
  const prepared = preparedByRepoId.get(repoId)
  const now = Date.now()
  if (!prepared || prepared.ran || now - prepared.preparedAt >= maxWaitMs) {
    return null
  }
  if (prepared.registeredAt === undefined) {
    return 'unregistered'
  }
  return now - prepared.registeredAt < graceMs ? 'settling' : 'pending'
}

/** One reading of the registered terminal. A single busy one may be a slow shell's rc child: the
 *  queued line ran once busy readings persist `persistMs`. True once it is known to have run. */
export function notePreparedSpotlightLaunchReading(
  repoId: string,
  busy: boolean,
  persistMs: number
): boolean {
  const prepared = preparedByRepoId.get(repoId)
  if (prepared?.registeredAt === undefined) {
    return false
  }
  if (!prepared.ran) {
    const now = Date.now()
    prepared.busySince = busy ? (prepared.busySince ?? now) : undefined
    prepared.ran = prepared.busySince !== undefined && now - prepared.busySince >= persistMs
  }
  return prepared.ran
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
