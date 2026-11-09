import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createStore, type StoreApi } from 'zustand/vanilla'
import type {
  ClaudeManagedAccount,
  ClaudeManagedAccountSummary,
  ClaudeRateLimitAccountsState
} from '../../../shared/managed-account-types'
import type {
  SpotlightAgentStatus,
  SpotlightResumeAccountPick
} from '../../../shared/spotlight-agent-turn'
import type * as RestartStartup from './agent-session/accounts/agent-account-restart-startup'
import type * as PasteDraft from './agent-paste-draft'

// Only what Continuar reads and calls; the store's own actions are recorded, not run.
type TestState = {
  spotlightTurns: SpotlightAgentStatus
  agentStatusByPaneKey: Record<
    string,
    { state: string; agentType: string; providerSession?: Record<string, string> }
  >
  settings: { claudeManagedAccounts: ClaudeManagedAccount[] }
  tabsByWorktree: Record<string, { id: string; worktreeId: string }[]>
  terminalLayoutsByTabId: Record<string, { ptyIdsByLeafId: Record<string, string> }>
  ptyIdsByTabId: Record<string, string[]>
  queuePaneAccountRestarts: (ptyIds: string[], agent: string) => void
  consumePendingPaneAccountRestart: (ptyId: string) => void
  fetchSettings: () => Promise<void>
}

const harness = vi.hoisted(() => ({
  store: undefined as StoreApi<TestState> | undefined,
  events: [] as string[]
}))

vi.mock('@/store', () => ({
  useAppStore: {
    getState: () => harness.store?.getState(),
    subscribe: (listener: (state: TestState) => void) => harness.store?.subscribe(listener)
  }
}))
vi.mock('./agent-session/accounts/agent-account-restart-startup', async (importOriginal) => ({
  ...(await importOriginal<typeof RestartStartup>()),
  buildPaneAccountRestartStartup: vi.fn()
}))
vi.mock('./agent-followup-delivery', () => ({
  sendFollowupPromptWhenAgentReady: vi.fn(async (args: { ptyId: string }) => {
    harness.events.push(`followup:${args.ptyId}`)
    return true
  })
}))
vi.mock('./agent-paste-draft', async (importOriginal) => ({
  ...(await importOriginal<typeof PasteDraft>()),
  sendBracketedPasteToRunningAgent: vi.fn(async (args: { ptyId: string }) => {
    await Promise.resolve()
    harness.events.push(`paste:${args.ptyId}`)
    return true
  })
}))

import { buildPaneAccountRestartStartup } from './agent-session/accounts/agent-account-restart-startup'
import { sendBracketedPasteToRunningAgent } from './agent-paste-draft'
import { continueTestTask } from './test-queue-continue'

const WT = 'repo-1::/repo/feature'
const TAB = 'tab-1'
const LEAF = '3f2504e0-4f89-41d3-9a0c-0305e82c3301'
const OTHER_LEAF = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d'
const PANE = `${TAB}:${LEAF}`
const OTHER_PANE = `${TAB}:${OTHER_LEAF}`
const PTY = 'pty-1'
const OTHER_PTY = 'pty-other'
const WORK_HOME = '/Users/juan/.orca/claude-accounts/work'
const PERSONAL_HOME = '/Users/juan/.orca/claude-accounts/personal'
const ON_WORK = `${WORK_HOME}/projects/-repo-feature/session-1.jsonl`
const OWN_FOLDER = '/tmp/own-claude/projects/-repo-feature/session-1.jsonl'

const savedAccount = (id: string, home: string): ClaudeManagedAccount => ({
  id,
  email: `${id}@example.com`,
  managedAuthPath: home,
  authMethod: 'subscription-oauth',
  createdAt: 1,
  updatedAt: 1,
  lastAuthenticatedAt: 1
})
const summary = (id: string, home: string): ClaudeManagedAccountSummary => ({
  id,
  email: `${id}@example.com`,
  authMethod: 'subscription-oauth',
  createdAt: 1,
  updatedAt: 1,
  lastAuthenticatedAt: 1,
  home
})
const HOST: ClaudeRateLimitAccountsState = {
  accounts: [summary('work', WORK_HOME), summary('personal', PERSONAL_HOME)],
  activeAccountId: 'work',
  systemDefaultHome: '/Users/juan/.claude'
}
const PICK_WORK: SpotlightResumeAccountPick = { kind: 'account', accountId: 'work', label: 'work' }
const PICK_PERSONAL: SpotlightResumeAccountPick = {
  kind: 'account',
  accountId: 'personal',
  label: 'personal'
}

const api = {
  spotlight: {
    markResuming: vi.fn(async (_paneKey: string, _options: { auto: boolean }) => {
      harness.events.push('markResuming')
      return true
    }),
    resumeSettled: vi.fn(async (_paneKey: string, result: { delivered: boolean }) => {
      harness.events.push(`settled:${result.delivered}`)
    }),
    pickResumeAccount: vi.fn(async (): Promise<SpotlightResumeAccountPick> => {
      harness.events.push('pick')
      return PICK_WORK
    })
  },
  claudeAccounts: {
    list: vi.fn(async () => HOST),
    select: vi.fn(async (selection: { accountId: string | null; runtime?: string }) => {
      harness.events.push(`select:${selection.runtime}:${selection.accountId}`)
      return { ...HOST, activeAccountId: selection.accountId }
    })
  },
  pty: {
    write: vi.fn((ptyId: string, data: string, inputKind: string) => {
      harness.events.push(`${data === '\x1b' ? 'esc' : data}:${inputKind}:${ptyId}`)
    })
  },
  platform: { get: () => ({ platform: 'darwin' }) }
}

function pickReturns(pick: SpotlightResumeAccountPick): void {
  api.spotlight.pickResumeAccount.mockImplementationOnce(async () => {
    harness.events.push('pick')
    return pick
  })
}

function pausedBoard(): SpotlightAgentStatus {
  const row = { taskKey: 'AG-12', repoNames: ['orca'], since: 1, pausedAt: 2 }
  return {
    turns: [],
    waiting: [],
    paused: [{ ...row, paneKey: PANE, reason: 'limit' }],
    lit: []
  }
}

function holdingBoard(): SpotlightAgentStatus {
  const turn = { taskKey: 'AG-12', repoNames: ['orca'], panes: 2, grantedAt: 1 }
  // The pane that asked last is the one Continuar talks to.
  return { turns: [{ ...turn, paneKeys: [OTHER_PANE, PANE] }], waiting: [], paused: [], lit: [] }
}

type PaneStatus = TestState['agentStatusByPaneKey'][string]

function claudePane(state: string, transcriptPath?: string): PaneStatus {
  return {
    state,
    agentType: 'claude',
    ...(transcriptPath
      ? { providerSession: { key: 'session_id', id: 'session-1', transcriptPath } }
      : {})
  }
}

function seed(board: SpotlightAgentStatus, paneStatus: PaneStatus): void {
  harness.store = createStore<TestState>()(() => ({
    spotlightTurns: board,
    agentStatusByPaneKey: { [PANE]: paneStatus, [OTHER_PANE]: claudePane('done', ON_WORK) },
    settings: {
      claudeManagedAccounts: [
        savedAccount('work', WORK_HOME),
        savedAccount('personal', PERSONAL_HOME)
      ]
    },
    tabsByWorktree: { [WT]: [{ id: TAB, worktreeId: WT }] },
    terminalLayoutsByTabId: {
      [TAB]: { ptyIdsByLeafId: { [LEAF]: PTY, [OTHER_LEAF]: OTHER_PTY } }
    },
    ptyIdsByTabId: { [TAB]: [PTY, OTHER_PTY] },
    queuePaneAccountRestarts: (ptyIds, agent) => {
      harness.events.push(`restart:${agent}:${ptyIds.join(',')}`)
    },
    consumePendingPaneAccountRestart: (ptyId) => {
      harness.events.push(`withdraw:${ptyId}`)
    },
    fetchSettings: async () => {
      harness.events.push('fetchSettings')
    }
  }))
}

/** What the restart executor leaves: the pane on a new PTY, the old one gone from the tab. */
function finishRestart(nextPtyId: string): void {
  harness.store?.setState({
    terminalLayoutsByTabId: {
      [TAB]: { ptyIdsByLeafId: { [LEAF]: nextPtyId, [OTHER_LEAF]: OTHER_PTY } }
    },
    ptyIdsByTabId: { [TAB]: [nextPtyId, OTHER_PTY] }
  })
}

beforeEach(() => {
  harness.events.length = 0
  vi.clearAllMocks()
  vi.mocked(buildPaneAccountRestartStartup).mockReturnValue({
    command: 'claude --resume session-1',
    startupCommandDelivery: 'shell-ready',
    launchAgent: 'claude'
  })
  vi.stubGlobal('window', { api })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('Continuar on a paused pane', () => {
  it('does nothing when main will not open the resume window', async () => {
    seed(pausedBoard(), claudePane('done', ON_WORK))
    api.spotlight.markResuming.mockImplementationOnce(async () => {
      harness.events.push('markResuming')
      return false
    })

    expect(await continueTestTask(PANE, { auto: true })).toMatchObject({ delivered: false })

    expect(harness.events).toEqual(['markResuming'])
  })

  it('pastes the follow-up when the pane already runs on the account with limit', async () => {
    seed(pausedBoard(), claudePane('done', ON_WORK))

    expect(await continueTestTask(PANE, { auto: false })).toMatchObject({ delivered: true })

    expect(harness.events).toEqual(['markResuming', 'pick', `paste:${PTY}`, 'settled:true'])
  })

  it('leaves the pane paused when no account has limit left', async () => {
    seed(pausedBoard(), claudePane('done', ON_WORK))
    pickReturns({ kind: 'none', returnsAt: 1_700_000_000_000 })

    // Why the pick: auto-resume retries at `returnsAt`.
    expect(await continueTestTask(PANE, { auto: false })).toEqual({
      delivered: false,
      pick: { kind: 'none', returnsAt: 1_700_000_000_000 }
    })

    expect(harness.events).toEqual(['markResuming', 'pick', 'settled:false'])
  })

  it.each([
    ['its own config folder', OWN_FOLDER],
    ['no hook evidence of its folder', undefined]
  ])('never switches the account for a pane on %s', async (_case, transcriptPath) => {
    seed(pausedBoard(), claudePane('done', transcriptPath))
    pickReturns(PICK_PERSONAL)

    expect(await continueTestTask(PANE, { auto: false })).toMatchObject({ delivered: false })

    expect(harness.events).toEqual(['markResuming', 'pick', 'settled:false'])
  })

  it('moves only this pane to the account with limit and continues on its new PTY', async () => {
    seed(pausedBoard(), claudePane('done', ON_WORK))
    pickReturns(PICK_PERSONAL)

    const result = continueTestTask(PANE, { auto: false })
    await vi.waitFor(() => expect(harness.events).toContain(`restart:claude:${PTY}`))
    expect(harness.events.some((event) => event.startsWith('followup:'))).toBe(false)
    finishRestart('pty-2')

    expect(await result).toMatchObject({ delivered: true })
    expect(harness.events).toEqual([
      'markResuming',
      'pick',
      'select:host:personal',
      'fetchSettings',
      `restart:claude:${PTY}`,
      'followup:pty-2',
      'settled:true'
    ])
  })

  it('keeps the account when the pane has no conversation to resume', async () => {
    seed(pausedBoard(), claudePane('done', ON_WORK))
    pickReturns(PICK_PERSONAL)
    vi.mocked(buildPaneAccountRestartStartup).mockReturnValue(null)

    expect(await continueTestTask(PANE, { auto: false })).toMatchObject({ delivered: false })

    expect(harness.events).toEqual(['markResuming', 'pick', 'settled:false'])
  })

  it('gives up and withdraws the restart when the pane is not back within 2 minutes', async () => {
    vi.useFakeTimers()
    seed(pausedBoard(), claudePane('done', ON_WORK))
    pickReturns(PICK_PERSONAL)

    const result = continueTestTask(PANE, { auto: true })
    await vi.waitFor(() => expect(harness.events).toContain(`restart:claude:${PTY}`))
    await vi.advanceTimersByTimeAsync(2 * 60_000)

    expect(await result).toMatchObject({ delivered: false })
    expect(harness.events.slice(-2)).toEqual([`withdraw:${PTY}`, 'settled:false'])
    expect(harness.events.some((event) => event.startsWith('followup:'))).toBe(false)
  })
})

describe('Continuar on an idle holder', () => {
  it('interrupts its last pane in place and pastes once the agent stops working', async () => {
    seed(holdingBoard(), claudePane('working', ON_WORK))

    const result = continueTestTask(OTHER_PANE, { auto: false })
    await vi.waitFor(() => expect(harness.events).toContain(`esc:driving:${PTY}`))
    expect(sendBracketedPasteToRunningAgent).not.toHaveBeenCalled()
    harness.store?.setState((state) => ({
      agentStatusByPaneKey: { ...state.agentStatusByPaneKey, [PANE]: claudePane('done', ON_WORK) }
    }))

    expect(await result).toMatchObject({ delivered: true })
    expect(api.spotlight.markResuming).toHaveBeenCalledWith(PANE, { auto: false })
    expect(harness.events).toEqual([
      'markResuming',
      `esc:driving:${PTY}`,
      `paste:${PTY}`,
      'settled:true'
    ])
  })

  it('leaves a gap after the Esc before pasting, even when the agent is not working', async () => {
    vi.useFakeTimers()
    seed(holdingBoard(), claudePane('done', ON_WORK))

    const result = continueTestTask(OTHER_PANE, { auto: false })
    await vi.waitFor(() => expect(harness.events).toContain(`esc:driving:${PTY}`))
    await vi.advanceTimersByTimeAsync(400)
    // Why: Esc glued to the paste's own escape sequence reads as one key to the agent's input.
    expect(sendBracketedPasteToRunningAgent).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(100)

    expect(await result).toMatchObject({ delivered: true })
    expect(harness.events.slice(-2)).toEqual([`paste:${PTY}`, 'settled:true'])
  })

  it('is never interrupted by an automatic resume', async () => {
    seed(holdingBoard(), claudePane('working', ON_WORK))

    expect(await continueTestTask(OTHER_PANE, { auto: true })).toEqual({ delivered: false })

    expect(api.spotlight.markResuming).not.toHaveBeenCalled()
    expect(harness.events).toEqual([])
  })
})
