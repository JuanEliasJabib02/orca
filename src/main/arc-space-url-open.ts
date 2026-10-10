import { stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { runProcess } from '@orca/process-host'
import type { GlobalSettings } from '../shared/global-settings-types'

const ARC_BUNDLE_ID = 'company.thebrowser.Browser'

// Why argv: the URL and space name never become script text, so neither can inject AppleScript.
const OPEN_IN_ARC_SPACE_SCRIPT = [
  'on run argv',
  'set targetUrl to item 1 of argv',
  'set spaceName to item 2 of argv',
  `tell application id "${ARC_BUNDLE_ID}"`,
  'activate',
  'tell front window',
  'tell space spaceName',
  'focus',
  'make new tab with properties {URL:targetUrl}',
  'end tell',
  'end tell',
  'end tell',
  'end run'
]

/** The Arc space an external open targets, or null when the opt-in is off or no name was sent. */
export function resolveRequestedArcSpace(
  settings: Pick<GlobalSettings, 'openLinksInArcSpaces'>,
  options: unknown
): string | null {
  if (settings.openLinksInArcSpaces !== true) {
    return null
  }
  // Why the checks: IPC arguments come from the renderer and are untyped at runtime.
  if (typeof options !== 'object' || options === null || !('arcSpace' in options)) {
    return null
  }
  const { arcSpace } = options
  return typeof arcSpace === 'string' && arcSpace.trim() ? arcSpace.trim() : null
}

async function isArcInstalled(): Promise<boolean> {
  // Why a path check: AppleScript naming a missing app can stop on a "Where is Arc?" dialog.
  for (const candidate of ['/Applications/Arc.app', join(homedir(), 'Applications', 'Arc.app')]) {
    try {
      if ((await stat(candidate)).isDirectory()) {
        return true
      }
    } catch {
      // Not at this location; try the next one.
    }
  }
  return false
}

/** Opens `url` as a new tab in the named Arc space; false means the caller should open it normally. */
export async function openUrlInArcSpace(
  url: string,
  spaceName: string,
  platform: NodeJS.Platform = process.platform
): Promise<boolean> {
  if (platform !== 'darwin' || !(await isArcInstalled())) {
    return false
  }
  try {
    // Why the timeout: the first use waits on macOS's Automation prompt, a hung Arc must not eat the click.
    const result = await runProcess({
      program: '/usr/bin/osascript',
      args: [...OPEN_IN_ARC_SPACE_SCRIPT.flatMap((line) => ['-e', line]), url, spaceName],
      timeoutMs: 10_000,
      maxOutputBytes: 64 * 1024,
      killOnOutputLimit: true
    })
    return result.code === 0 && !result.timedOut
  } catch {
    return false
  }
}
