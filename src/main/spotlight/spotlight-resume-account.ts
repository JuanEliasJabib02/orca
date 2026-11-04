// The Claude account Continuar resumes a paused task with: any logged-in one, most limit left.
import type { ClaudeRateLimitAccountsState } from '../../shared/managed-account-types'
import type { ProviderRateLimits } from '../../shared/rate-limit-types'
import type { SpotlightResumeAccountPick } from '../../shared/spotlight-agent-turn'
import {
  claudeUsagePeakPercent,
  readSnapshot,
  refreshUsage,
  type SpotlightUsageSource
} from './spotlight-agent-turn-usage'

const FULL_PERCENT = 100

// Why: main has no catalog; the renderer may relabel `accountId: null` in the user's language.
const SYSTEM_DEFAULT_LABEL = 'System default'

type UsageSnapshot = ReturnType<SpotlightUsageSource['getSnapshot']>
type ClaudeAccount = ClaudeRateLimitAccountsState['accounts'][number]

type ResumeCandidate = {
  accountId: string | null
  label: string
  limits: ProviderRateLimits | null | undefined
}

const NO_ACCOUNT: SpotlightResumeAccountPick = { kind: 'none', returnsAt: null }

// Why: Continuar switches the host's account, so a WSL account could never run the pane.
function canResumeOn(account: ClaudeAccount): boolean {
  return !account.needsSignIn && account.managedAuthRuntime !== 'wsl'
}

/** The active account (null = System default), whose usage is the polled `rateLimits.claude`. */
function activeCandidate({ claude, rateLimits }: UsageSnapshot): ResumeCandidate | null {
  if (claude.activeAccountId === null) {
    return {
      accountId: null,
      label: claude.systemDefaultEmail ?? SYSTEM_DEFAULT_LABEL,
      limits: rateLimits.claude
    }
  }
  const account = claude.accounts.find((saved) => saved.id === claude.activeAccountId)
  return account && canResumeOn(account)
    ? { accountId: account.id, label: account.email, limits: rateLimits.claude }
    : null
}

/** Every account Continuar could switch to, the active one first so it wins ties. */
function resumeCandidates(snapshot: UsageSnapshot): ResumeCandidate[] {
  const { claude, rateLimits } = snapshot
  const active = activeCandidate(snapshot)
  const inactive = claude.accounts
    .filter((account) => account.id !== claude.activeAccountId && canResumeOn(account))
    .map((account) => ({
      accountId: account.id,
      label: account.email,
      limits: rateLimits.inactiveClaudeAccounts.find((usage) => usage.accountId === account.id)
        ?.rateLimits
    }))
  return active ? [active, ...inactive] : inactive
}

/** When an account at its limit gets it back: its latest known reset among its full windows. */
function limitReturnsAt(limits: ProviderRateLimits | null | undefined): number | null {
  const resets = [limits?.session, limits?.weekly, limits?.fableWeekly].flatMap((window) =>
    window && window.usedPercent >= FULL_PERCENT && window.resetsAt !== null
      ? [window.resetsAt]
      : []
  )
  return resets.length > 0 ? Math.max(...resets) : null
}

/**
 * The account with the most limit left (`max(session, weekly, fableWeekly)` lowest, under 100%),
 * after a forced usage read of the active and the inactive accounts. Accounts that need a sign-in
 * or whose usage is unknown never win. None → when the first account at its limit gets it back.
 */
export async function pickResumeAccount(
  accounts: SpotlightUsageSource | null
): Promise<SpotlightResumeAccountPick> {
  const service = accounts?.usageRateLimits() ?? null
  if (!accounts || !service) {
    return NO_ACCOUNT
  }
  // Why both: the pick compares the active account with the inactive ones (D7).
  await refreshUsage(service, true)
  const snapshot = readSnapshot(accounts)
  if (!snapshot) {
    return NO_ACCOUNT
  }
  let best: { candidate: ResumeCandidate; peak: number } | null = null
  let returnsAt: number | null = null
  for (const candidate of resumeCandidates(snapshot)) {
    const peak = claudeUsagePeakPercent(candidate.limits)
    if (peak === null) {
      continue
    }
    if (peak < FULL_PERCENT) {
      if (!best || peak < best.peak) {
        best = { candidate, peak }
      }
      continue
    }
    const back = limitReturnsAt(candidate.limits)
    if (back !== null && (returnsAt === null || back < returnsAt)) {
      returnsAt = back
    }
  }
  if (best) {
    return { kind: 'account', accountId: best.candidate.accountId, label: best.candidate.label }
  }
  return { kind: 'none', returnsAt }
}
