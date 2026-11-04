// Whether an agent that stopped mid-turn ran out of usage limit: its account at 100% in any window.
import type { AgentStatusIpcPayload } from '../../shared/agent-status/contracts/agent-status-ipc-payload'
import {
  isClaudePaneOnAccount,
  resolveClaudePaneFolder,
  type ClaudePaneFolder
} from '../../shared/claude-pane-account-folder'
import type {
  ClaudeManagedAccount,
  ClaudeRateLimitAccountsState
} from '../../shared/managed-account-types'
import type { ProviderRateLimits, RateLimitState } from '../../shared/rate-limit-types'

// Why: a hung usage request must not keep a stopped agent's turn; the cached usage decides then.
const USAGE_REFRESH_TIMEOUT_MS = 15_000

type UsageRefresher = {
  refresh: () => Promise<unknown>
  fetchInactiveClaudeAccountsOnOpen: () => Promise<unknown>
}

/** The slice of the account services a pause reads: `RuntimeAccountController` fits it. */
export type SpotlightUsageSource = {
  usageRateLimits: () => UsageRefresher | null
  getSnapshot: () => {
    claude: ClaudeRateLimitAccountsState
    rateLimits: Pick<RateLimitState, 'claude' | 'inactiveClaudeAccounts'>
  }
}

type UsageSnapshot = ReturnType<SpotlightUsageSource['getSnapshot']>

/** Where the pane's Claude keeps its config, from the newest hook row that names a transcript. */
export function paneTranscriptPath(
  rows: readonly Pick<AgentStatusIpcPayload, 'receivedAt' | 'providerSession'>[]
): string | undefined {
  let newest: { at: number; path: string } | null = null
  for (const row of rows) {
    const path = row.providerSession?.transcriptPath
    if (path && (!newest || row.receivedAt > newest.at)) {
      newest = { at: row.receivedAt, path }
    }
  }
  return newest?.path
}

/** The fullest of an account's windows, `max(session, weekly, fableWeekly)`; null when none is known. */
export function claudeUsagePeakPercent(
  limits: ProviderRateLimits | null | undefined
): number | null {
  const known = [limits?.session, limits?.weekly, limits?.fableWeekly].flatMap((window) =>
    window ? [window.usedPercent] : []
  )
  return known.length > 0 ? Math.max(...known) : null
}

function readSnapshot(accounts: SpotlightUsageSource): UsageSnapshot | null {
  try {
    return accounts.getSnapshot()
  } catch {
    return null
  }
}

/** The account a pane runs on (null = System default); undefined when its folder says nothing. */
function paneAccountId(
  folder: ClaudePaneFolder | undefined,
  claude: ClaudeRateLimitAccountsState
): string | null | undefined {
  if (!folder || folder.kind === 'own-folder') {
    return undefined
  }
  if (isClaudePaneOnAccount(folder, claude.activeAccountId, claude)) {
    return claude.activeAccountId
  }
  if (folder.kind === 'account') {
    return folder.accountId
  }
  return claude.accounts.find((account) => isClaudePaneOnAccount(folder, account.id, claude))?.id
}

async function refreshUsage(
  service: UsageRefresher | null,
  includeInactive: boolean
): Promise<void> {
  if (!service) {
    return
  }
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, USAGE_REFRESH_TIMEOUT_MS)
  })
  try {
    const reads = [
      service.refresh(),
      ...(includeInactive ? [service.fetchInactiveClaudeAccountsOnOpen()] : [])
    ]
    await Promise.race([Promise.allSettled(reads), timeout])
  } catch {
    // Why: a read that fails leaves the cached usage, which still tells most cuts apart.
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Whether the pane's Claude account is at 100% in any window, after one forced usage read (the
 * active account is otherwise polled every 15 min). False when the pane's account can't be told.
 */
export async function isPaneAccountAtLimit(args: {
  transcriptPath: string | undefined
  saved: readonly ClaudeManagedAccount[]
  accounts: SpotlightUsageSource | null
  platform: NodeJS.Platform
}): Promise<boolean> {
  const before = args.accounts ? readSnapshot(args.accounts) : null
  if (!args.accounts || !before) {
    return false
  }
  const folder = resolveClaudePaneFolder(
    args.transcriptPath,
    args.saved,
    before.claude,
    args.platform
  )
  const accountId = paneAccountId(folder, before.claude)
  if (accountId === undefined) {
    return false
  }
  const active = accountId === before.claude.activeAccountId
  await refreshUsage(args.accounts.usageRateLimits(), !active)
  const { rateLimits } = readSnapshot(args.accounts) ?? before
  const limits = active
    ? rateLimits.claude
    : rateLimits.inactiveClaudeAccounts.find((usage) => usage.accountId === accountId)?.rateLimits
  return (claudeUsagePeakPercent(limits) ?? 0) >= 100
}
