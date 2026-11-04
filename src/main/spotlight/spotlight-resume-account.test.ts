import { describe, expect, it, vi } from 'vitest'
import type {
  ClaudeManagedAccountSummary,
  ClaudeRateLimitAccountsState
} from '../../shared/managed-account-types'
import type {
  InactiveAccountUsage,
  ProviderRateLimits,
  RateLimitWindow
} from '../../shared/rate-limit-types'
import type { SpotlightUsageSource } from './spotlight-agent-turn-usage'
import { pickResumeAccount } from './spotlight-resume-account'

const NOW = Date.UTC(2026, 10, 4, 12, 0)
const HOUR = 3_600_000

function account(
  id: string,
  extra: Partial<ClaudeManagedAccountSummary> = {}
): ClaudeManagedAccountSummary {
  return {
    id,
    email: `${id}@example.com`,
    authMethod: 'subscription-oauth',
    createdAt: 0,
    updatedAt: 0,
    lastAuthenticatedAt: 0,
    ...extra
  }
}

function used(usedPercent: number, resetsAt: number | null = null): RateLimitWindow {
  return { usedPercent, windowMinutes: 300, resetsAt, resetDescription: null }
}

function limits(windows: {
  session?: RateLimitWindow
  weekly?: RateLimitWindow
  fableWeekly?: RateLimitWindow
}): ProviderRateLimits {
  return {
    provider: 'claude',
    session: windows.session ?? null,
    weekly: windows.weekly ?? null,
    fableWeekly: windows.fableWeekly ?? null,
    updatedAt: 0,
    error: null,
    status: 'ok'
  }
}

function inactive(accountId: string, rateLimits: ProviderRateLimits | null): InactiveAccountUsage {
  return { accountId, rateLimits, updatedAt: 0, isFetching: false }
}

function fakeAccounts(state: {
  claude: ClaudeRateLimitAccountsState
  active: ProviderRateLimits | null
  inactive: InactiveAccountUsage[]
}) {
  const refresh = vi.fn(async () => {})
  const fetchInactiveClaudeAccountsOnOpen = vi.fn(async () => {})
  const source: SpotlightUsageSource = {
    usageRateLimits: () => ({ refresh, fetchInactiveClaudeAccountsOnOpen }),
    getSnapshot: () => ({
      claude: state.claude,
      rateLimits: { claude: state.active, inactiveClaudeAccounts: state.inactive }
    })
  }
  return { source, state, refresh, fetchInactiveClaudeAccountsOnOpen }
}

describe('pickResumeAccount', () => {
  it('picks the account under 100% whose fullest window is the emptiest', async () => {
    const { source } = fakeAccounts({
      claude: {
        accounts: [
          account('weekly-60'),
          account('fable-80'),
          account('weekly-100'),
          account('work')
        ],
        activeAccountId: 'work'
      },
      active: limits({ session: used(70) }),
      inactive: [
        inactive('weekly-60', limits({ session: used(10), weekly: used(60) })),
        inactive('fable-80', limits({ session: used(5), weekly: used(5), fableWeekly: used(80) })),
        inactive('weekly-100', limits({ session: used(0), weekly: used(100) }))
      ]
    })

    await expect(pickResumeAccount(source)).resolves.toEqual({
      kind: 'account',
      accountId: 'weekly-60',
      label: 'weekly-60@example.com'
    })
  })

  it('keeps the active account on a tie, System default included', async () => {
    const managed = fakeAccounts({
      claude: { accounts: [account('other'), account('work')], activeAccountId: 'work' },
      active: limits({ session: used(40) }),
      inactive: [inactive('other', limits({ session: used(40) }))]
    })
    const systemDefault = fakeAccounts({
      claude: {
        accounts: [account('other')],
        activeAccountId: null,
        systemDefaultEmail: 'me@example.com'
      },
      active: limits({ session: used(40) }),
      inactive: [inactive('other', limits({ session: used(40) }))]
    })

    await expect(pickResumeAccount(managed.source)).resolves.toEqual({
      kind: 'account',
      accountId: 'work',
      label: 'work@example.com'
    })
    await expect(pickResumeAccount(systemDefault.source)).resolves.toEqual({
      kind: 'account',
      accountId: null,
      label: 'me@example.com'
    })
  })

  it('skips accounts that need a sign-in, run in WSL, or whose usage is unknown', async () => {
    const { source } = fakeAccounts({
      claude: {
        accounts: [
          account('signed-out', { needsSignIn: true }),
          account('wsl', { managedAuthRuntime: 'wsl', wslDistro: 'Ubuntu' }),
          account('null-usage'),
          account('no-windows'),
          account('never-fetched'),
          account('work')
        ],
        activeAccountId: 'work'
      },
      active: limits({ session: used(90) }),
      inactive: [
        inactive('signed-out', limits({ session: used(0) })),
        inactive('wsl', limits({ session: used(0) })),
        inactive('null-usage', null),
        inactive('no-windows', limits({}))
      ]
    })

    await expect(pickResumeAccount(source)).resolves.toEqual({
      kind: 'account',
      accountId: 'work',
      label: 'work@example.com'
    })
  })

  it('returns none and the earliest return, each account at its latest full window', async () => {
    const { source } = fakeAccounts({
      claude: { accounts: [account('other'), account('work')], activeAccountId: 'work' },
      active: limits({ session: used(100, NOW + HOUR), weekly: used(100, NOW + 72 * HOUR) }),
      inactive: [
        inactive(
          'other',
          limits({ session: used(100, NOW + 2 * HOUR), weekly: used(50, NOW + HOUR / 2) })
        )
      ]
    })

    await expect(pickResumeAccount(source)).resolves.toEqual({
      kind: 'none',
      returnsAt: NOW + 2 * HOUR
    })
  })

  it('returns none without a return time when no full window says when it resets', async () => {
    const { source } = fakeAccounts({
      claude: { accounts: [account('work')], activeAccountId: 'work' },
      active: limits({ session: used(100), weekly: used(20, NOW + HOUR) }),
      inactive: []
    })

    await expect(pickResumeAccount(source)).resolves.toEqual({ kind: 'none', returnsAt: null })
  })

  it('reads the usage only after refreshing the active and the inactive accounts', async () => {
    const accounts = fakeAccounts({
      claude: { accounts: [account('other'), account('work')], activeAccountId: 'work' },
      active: limits({ session: used(10) }),
      inactive: [inactive('other', null)]
    })
    accounts.refresh.mockImplementation(async () => {
      accounts.state.active = limits({ session: used(100, NOW + HOUR) })
    })
    accounts.fetchInactiveClaudeAccountsOnOpen.mockImplementation(async () => {
      accounts.state.inactive = [inactive('other', limits({ session: used(30) }))]
    })

    await expect(pickResumeAccount(accounts.source)).resolves.toEqual({
      kind: 'account',
      accountId: 'other',
      label: 'other@example.com'
    })
    expect(accounts.refresh).toHaveBeenCalledTimes(1)
    expect(accounts.fetchInactiveClaudeAccountsOnOpen).toHaveBeenCalledTimes(1)
  })

  it('picks no account without the usage service or when the accounts cannot be read', async () => {
    const { source } = fakeAccounts({
      claude: { accounts: [account('work')], activeAccountId: 'work' },
      active: limits({ session: used(10) }),
      inactive: []
    })
    const none = { kind: 'none', returnsAt: null }

    await expect(pickResumeAccount(null)).resolves.toEqual(none)
    await expect(pickResumeAccount({ ...source, usageRateLimits: () => null })).resolves.toEqual(
      none
    )
    await expect(
      pickResumeAccount({
        ...source,
        getSnapshot: () => {
          throw new Error('account services not ready')
        }
      })
    ).resolves.toEqual(none)
  })
})
