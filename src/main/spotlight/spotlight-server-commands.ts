// Last server command Orca ran per repo. Outlives the Spotlight terminal's PTY (a respawn
// registers a new capture) and is forgotten when Spotlight turns off. Its own module so the
// log mirror's restart trigger can read it without importing server control (import cycle).
import { takeSpotlightInstallPrefix } from './spotlight-lockfile-install'

const commandByRepoId = new Map<string, string>()
// Why separate: a busy start remembers its command for restarts without having typed it.
const launchedByRepoId = new Map<string, string>()

export function rememberSpotlightServerCommand(repoId: string, command: string): void {
  commandByRepoId.set(repoId, command)
}

export function getSpotlightServerCommand(repoId: string): string | undefined {
  return commandByRepoId.get(repoId)
}

/** Orca typed (or queued as a startup command) `command` into the Spotlight terminal. */
export function markSpotlightServerLaunched(repoId: string, command: string): void {
  launchedByRepoId.set(repoId, command)
}

/** The command Orca itself last ran there; undefined means a running server was started by hand. */
export function getSpotlightServerLaunchedCommand(repoId: string): string | undefined {
  return launchedByRepoId.get(repoId)
}

/** What a restart re-runs, with a pending install first. Without a stored command the restart
 *  recalls history instead, which leaves the install pending for Orca's next command. */
export function takeSpotlightServerRerunCommand(repoId: string): string | undefined {
  const command = commandByRepoId.get(repoId)
  if (!command) {
    return undefined
  }
  launchedByRepoId.set(repoId, command)
  return `${takeSpotlightInstallPrefix(repoId)}${command}`
}

export function forgetSpotlightServerCommand(repoId: string): void {
  commandByRepoId.delete(repoId)
  launchedByRepoId.delete(repoId)
}
