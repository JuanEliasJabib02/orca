// Which commits each Spotlight operation compares for pnpm-lock.yaml, and whether a server may
// already be running on the old dependencies. Runs under the repo lock (git reads only), so the
// flag is set before the operation returns and a later Spotlight off always clears it.
import type { SpotlightRepoState } from '../../shared/spotlight'
import type {
  SpotlightActivateOutcome,
  SpotlightGitContext,
  SpotlightSyncOutcome
} from '../../shared/spotlight-sync-core'
import { markSpotlightInstallIfLockfileChanged } from './spotlight-lockfile-install'
import { restartSpotlightServerForLockfileChange } from './spotlight-server-control'

type ResolvedRoot = { repo: { path: string }; ctx: SpotlightGitContext }

async function checkLockfileChange(
  repoId: string,
  resolved: ResolvedRoot,
  change: { fromSha: string | null | undefined; toSha: string; serverMayBeRunning: boolean }
): Promise<void> {
  const changed = await markSpotlightInstallIfLockfileChanged({
    repoId,
    ctx: resolved.ctx,
    rootPath: resolved.repo.path,
    fromSha: change.fromSha,
    toSha: change.toSha
  })
  if (changed && change.serverMayBeRunning) {
    // Detached: the busy check waits on the PTY host, which must not hold the repo lock.
    void restartSpotlightServerForLockfileChange(repoId)
  }
}

/** Fresh activation compares the root's own (backed-up) state; a takeover compares the previous
 *  holder's snapshot, whose server may still be running. */
export async function checkActivationLockfile(args: {
  repoId: string
  resolved: ResolvedRoot
  previous: SpotlightRepoState | null
  outcome: SpotlightActivateOutcome
}): Promise<void> {
  const { outcome } = args
  await checkLockfileChange(args.repoId, args.resolved, {
    fromSha: outcome.alreadyActive ? args.previous?.lastSnapshotSha : outcome.backupSha,
    toSha: outcome.snapshotSha,
    serverMayBeRunning: outcome.alreadyActive
  })
}

/** A sync that mirrored something compares the snapshot the root held before it. */
export async function checkSyncLockfile(args: {
  repoId: string
  resolved: ResolvedRoot
  before: SpotlightRepoState
  outcome: SpotlightSyncOutcome
}): Promise<void> {
  if (args.outcome.skipped) {
    return
  }
  await checkLockfileChange(args.repoId, args.resolved, {
    fromSha: args.before.lastSnapshotSha,
    toSha: args.outcome.snapshotSha,
    serverMayBeRunning: true
  })
}
