import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Repo } from '../../../../shared/repo-types'
import type { CreateWorktreeResult } from '../../../../shared/worktree/create-types'
import type { SetupRunPolicy } from '../../../../shared/orca-yaml-hook-types'
import { getDefaultRepoHookSettings } from '../../../../shared/constants'
import {
  prepareStoreCompanionWorktrees,
  resolveCompanionSetup,
  STORE_COMPANION_CREATION_DEPS
} from './companion-worktree-creation-deps'

const mocks = vi.hoisted(() => ({
  createWorktree: vi.fn(),
  checkRuntimeHooks: vi.fn(),
  resolveHookTrustContent: vi.fn(),
  isHookScriptContentTrusted: vi.fn(),
  ensureWorktreeHasInitialTerminal: vi.fn(),
  launchAppliesAgentArgs: vi.fn()
}))
const storeRepos = vi.hoisted(() => ({ current: [] as Repo[] }))

vi.mock('@/store', () => ({
  useAppStore: {
    getState: () => ({
      createWorktree: mocks.createWorktree,
      repos: storeRepos.current,
      settings: null,
      trustedOrcaHooks: {}
    })
  }
}))
vi.mock('@/components/right-sidebar/source-control-launch-agent-args-applicability', () => ({
  sourceControlLaunchAppliesAgentArgs: mocks.launchAppliesAgentArgs
}))
vi.mock('@/runtime/runtime-hooks-client', () => ({
  checkRuntimeHooks: mocks.checkRuntimeHooks
}))
vi.mock('@/lib/hook-script-trust-content', () => ({
  resolveHookTrustContent: mocks.resolveHookTrustContent,
  isHookScriptContentTrusted: mocks.isHookScriptContentTrusted
}))
vi.mock('@/lib/worktree-initial-terminal-seeding', () => ({
  ensureWorktreeHasInitialTerminal: mocks.ensureWorktreeHasInitialTerminal
}))

function repo(overrides: Partial<Repo> = {}): Repo {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: setup resolution reads only id, host and hookSettings.
  return {
    id: 'admin',
    path: '/work/admin',
    displayName: 'admin',
    badgeColor: '#111111',
    addedAt: 0,
    ...overrides
  } as Repo
}

function withPolicy(setupRunPolicy: SetupRunPolicy): Partial<Repo> {
  return { hookSettings: { ...getDefaultRepoHookSettings(), setupRunPolicy } }
}

const SETUP_HOOKS = {
  hasHooks: true,
  hooks: { scripts: { setup: 'pnpm install' } },
  mayNeedUpdate: false
}

beforeEach(() => {
  for (const mock of Object.values(mocks)) {
    mock.mockReset()
  }
  storeRepos.current = []
})

describe('STORE_COMPANION_CREATION_DEPS.createWorktree', () => {
  it('pins the branch, leaves the base to the repo, and launches no agent', async () => {
    mocks.createWorktree.mockResolvedValue({ worktree: { id: 'admin::wt' } })
    await STORE_COMPANION_CREATION_DEPS.createWorktree(repo(), {
      name: 'ax-3448',
      displayName: 'AX-3448',
      branchNameOverride: 'juan/ax-3448',
      setupDecision: 'skip',
      nameWasGenerated: true
    })

    const args = mocks.createWorktree.mock.calls[0] ?? []
    expect(args[0]).toBe('admin')
    expect(args[1]).toBe('ax-3448')
    expect(args[2]).toBeUndefined()
    expect(args[3]).toBe('skip')
    expect(args[10]).toBeUndefined()
    expect(args[12]).toBe('juan/ax-3448')
    expect(args[16]).toBeUndefined()
    expect(args[25]).toEqual({ nameWasGenerated: true })
  })
})

describe('STORE_COMPANION_CREATION_DEPS.seedTerminals', () => {
  it('starts setup in the background without activating the worktree', () => {
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: seeding reads only the worktree id and launch payloads.
    const result = {
      worktree: { id: 'admin::wt' },
      setup: { runnerScriptPath: '/tmp/setup.sh', envVars: {} }
    } as unknown as CreateWorktreeResult
    STORE_COMPANION_CREATION_DEPS.seedTerminals(result)
    expect(mocks.ensureWorktreeHasInitialTerminal).toHaveBeenCalledWith(
      expect.anything(),
      'admin::wt',
      undefined,
      result.setup,
      undefined,
      undefined,
      { activateCreatedTabs: false }
    )
  })

  it('does nothing when the create returned no setup work', () => {
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: seeding reads only the worktree id and launch payloads.
    STORE_COMPANION_CREATION_DEPS.seedTerminals({
      worktree: { id: 'x' }
    } as CreateWorktreeResult)
    expect(mocks.ensureWorktreeHasInitialTerminal).not.toHaveBeenCalled()
  })
})

describe('resolveCompanionSetup', () => {
  it('skips quietly when the repo skips setup by default', async () => {
    const decision = await resolveCompanionSetup(repo(withPolicy('skip-by-default')))
    expect(decision).toEqual({ decision: 'skip', needsUserDecision: false })
    expect(mocks.checkRuntimeHooks).not.toHaveBeenCalled()
  })

  it('skips quietly when there is no setup to run', async () => {
    mocks.checkRuntimeHooks.mockResolvedValue({
      hasHooks: false,
      hooks: null,
      mayNeedUpdate: false
    })
    expect(await resolveCompanionSetup(repo())).toEqual({
      decision: 'skip',
      needsUserDecision: false
    })
  })

  it('flags a repo whose policy asks instead of prompting', async () => {
    mocks.checkRuntimeHooks.mockResolvedValue(SETUP_HOOKS)
    const decision = await resolveCompanionSetup(repo(withPolicy('ask')))
    expect(decision).toEqual({ decision: 'skip', needsUserDecision: true })
    expect(mocks.resolveHookTrustContent).not.toHaveBeenCalled()
  })

  it('runs setup whose text is already trusted', async () => {
    mocks.checkRuntimeHooks.mockResolvedValue(SETUP_HOOKS)
    mocks.resolveHookTrustContent.mockResolvedValue({ kind: 'content', scriptContent: 'pnpm i' })
    mocks.isHookScriptContentTrusted.mockResolvedValue(true)
    expect(await resolveCompanionSetup(repo())).toEqual({
      decision: 'run',
      needsUserDecision: false
    })
  })

  it('flags setup text nobody approved yet instead of opening the trust prompt', async () => {
    mocks.checkRuntimeHooks.mockResolvedValue(SETUP_HOOKS)
    mocks.resolveHookTrustContent.mockResolvedValue({ kind: 'content', scriptContent: 'pnpm i' })
    mocks.isHookScriptContentTrusted.mockResolvedValue(false)
    expect(await resolveCompanionSetup(repo())).toEqual({
      decision: 'skip',
      needsUserDecision: true
    })
  })

  it('skips quietly when the hooks cannot be inspected', async () => {
    mocks.checkRuntimeHooks.mockRejectedValue(new Error('ssh down'))
    expect(await resolveCompanionSetup(repo())).toEqual({
      decision: 'skip',
      needsUserDecision: false
    })
  })
})

describe('prepareStoreCompanionWorktrees', () => {
  const primary = repo({ id: 'experience', displayName: 'experience' })
  const companion = repo(withPolicy('skip-by-default'))

  async function prepare(launchHostId: 'local' | undefined) {
    storeRepos.current = [primary, companion]
    mocks.createWorktree.mockResolvedValue({
      worktree: { id: 'admin::wt', path: '/worktrees/admin', branch: 'refs/heads/juan/ax-3448' }
    })
    return prepareStoreCompanionWorktrees({
      submit: { repoIds: ['admin'], grantAgentAccess: true },
      primaryRepo: primary,
      primary: {
        agent: 'claude',
        workspaceName: 'ax-3448',
        createDisplayName: undefined,
        nameIsAutoManaged: false,
        nameWasGenerated: false,
        effectiveBranchNameOverride: undefined,
        pendingFirstAgentMessageRename: false
      },
      agentCanReachCompanions: true,
      launchHostId,
      isCancelled: () => false
    })
  }

  it('asks the launch route whether CLI args reach the primary agent', async () => {
    mocks.launchAppliesAgentArgs.mockReturnValue(true)
    const plan = await prepare('local')
    expect(mocks.launchAppliesAgentArgs).toHaveBeenCalledWith({
      agent: 'claude',
      repoId: 'experience',
      executionHostId: 'local'
    })
    expect(plan.addDirPaths).toEqual(['/worktrees/admin'])
  })

  it('withholds `--add-dir` from a route that drops CLI args, yet creates the companion', async () => {
    mocks.launchAppliesAgentArgs.mockReturnValue(false)
    const plan = await prepare(undefined)
    expect(mocks.launchAppliesAgentArgs).toHaveBeenCalledWith({
      agent: 'claude',
      repoId: 'experience'
    })
    expect(plan.addDirPaths).toEqual([])
    expect(plan.createdCompanions).toEqual([{ repoName: 'admin', branch: 'juan/ax-3448' }])
  })
})
