// Last server command Orca ran per repo. Outlives the Spotlight terminal's PTY (a respawn
// registers a new capture) and is forgotten when Spotlight turns off. Its own module so the
// log mirror's restart trigger can read it without importing server control (import cycle).
import { takeSpotlightInstallPrefix } from './spotlight-lockfile-install'

const commandByRepoId = new Map<string, string>()

export function rememberSpotlightServerCommand(repoId: string, command: string): void {
  commandByRepoId.set(repoId, command)
}

export function getSpotlightServerCommand(repoId: string): string | undefined {
  return commandByRepoId.get(repoId)
}

/** What a restart re-runs, with a pending install first. Without a stored command the restart
 *  recalls history instead, which leaves the install pending for Orca's next command. */
export function takeSpotlightServerRerunCommand(repoId: string): string | undefined {
  const command = commandByRepoId.get(repoId)
  return command ? `${takeSpotlightInstallPrefix(repoId)}${command}` : undefined
}

export function forgetSpotlightServerCommand(repoId: string): void {
  commandByRepoId.delete(repoId)
}
