// A POSIX PTY's foreground group read in main, for a host whose inspect answer lacks
// `foregroundGroup` (a terminal daemon older than the field survives app updates). Same rule as the
// host's own reading: resolvePtyForegroundGroup over the PTY's root pid.
import type { RemoteForegroundEvidence } from '../../shared/foreground-process-evidence'
import { getStrictProcessTableSnapshot } from '../../shared/process-table-snapshot-reader'
import type { PtyForegroundGroup } from '../../shared/terminal-process-inspection'
import { resolvePtyForegroundGroup } from './posix-shell-foreground-group'
import type { IPtyProvider } from './types'

type PtyInventory = Pick<IPtyProvider, 'listProcesses'>

function isPid(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

/** The PTY's spawned pid: free from the answer's live POSIX fence, else from the host's inventory. */
async function resolvePtyRootPid(
  provider: PtyInventory,
  ptyId: string,
  evidence: RemoteForegroundEvidence | undefined
): Promise<number | null> {
  const fence = evidence?.verdict === 'live' && evidence.ptyId === ptyId ? evidence.fence : null
  if (fence?.platform === 'posix' && isPid(fence.shellPid)) {
    return fence.shellPid
  }
  const rootPid = (await provider.listProcesses()).find(
    (entry) => entry.id === ptyId
  )?.rootProcessId
  return isPid(rootPid) ? rootPid : null
}

/**
 * Null off POSIX, without a root pid, or when the capture can't tell; readers treat that as
 * unobserved. The capture is the TTL-shared one, so terminals polled together pay for one.
 */
export async function readPtyForegroundGroupFallback(
  provider: PtyInventory,
  ptyId: string,
  evidence: RemoteForegroundEvidence | undefined
): Promise<PtyForegroundGroup | null> {
  if (process.platform === 'win32') {
    return null
  }
  try {
    const rootPid = await resolvePtyRootPid(provider, ptyId, evidence)
    return rootPid === null
      ? null
      : resolvePtyForegroundGroup(await getStrictProcessTableSnapshot(), rootPid)
  } catch {
    return null
  }
}
