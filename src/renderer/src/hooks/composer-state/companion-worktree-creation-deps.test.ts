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
  launchAppliesAgentArgs: vi.fn(),
  getBaseRefDefault: vi.fn(),
  searchBaseRefs: vi.fn()
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
vi.mock('@/runtime/runtime-repo-client', () => ({
  getRuntimeRepoBaseRefDefault: mocks.getBaseRefDefault,
  searchRuntimeRepoBaseRefs: mocks.searchBaseRefs
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
  it('pins the branch and the base, and launches no agent', async () => {
    mocks.createWorktree.mockResolvedValue({ worktree: { id: 'admin::wt' } })
    await STORE_COMPANION_CREATION_DEPS.createWorktree(repo(), {
      name: 'ax-3448',
      displayName: 'AX-3448',
      branchNameOverride: 'juan/ax-3448',
      baseBranch: 'origin/develop',
      setupDecision: 'skip',
      nameWasGenerated: true
    })

    const args = mocks.createWorktree.mock.calls[0] ?? []
    expect(args[0]).toBe('admin')
    expect(args[1]).toBe('ax-3448')
    expect(args[2]).toBe('origin/develop')
    expect(args[3]).toBe('skip')
    expect(args[10]).toBeUndefined()
    expect(args[12]).toBe('juan/ax-3448')
    expect(args[16]).toBeUndefined()
    expect(args[25]).toEqual({ nameWasGenerated: true })
  })

  it('leaves the base to the repo when the companion has none', async () => {
    mocks.createWorktree.mockResolvedValue({ worktree: { id: 'admin::wt' } })
    await STORE_COMPANION_CREATION_DEPS.createWorktree(repo(), {
      name: 'ax-3448',
      setupDecision: 'run'
    })
    expect(mocks.createWorktree.mock.calls[0]?.[2]).toBeUndefined()
  })
})

describe('STORE_COMPANION_CREATION_DEPS base refs', () => {
  const remoteRepo = repo({ connectionId: 'devbox' })

  it("asks the companion's own host whether it has the exact ref", async () => {
    mocks.searchBaseRefs.mockResolvedValue(['origin/develop-old', 'origin/develop'])
    expect(await STORE_COMPANION_CREATION_DEPS.hasBaseRef(remoteRepo, 'origin/develop')).toBe(true)
    expect(mocks.searchBaseRefs).toHaveBeenCalledWith(
      expect.anything(),
      'admin',
      'origin/develop',
      expect.any(Number),
      'ssh:devbox'
    )
  })

  it('does not take a near match for the ref', async () => {
    mocks.searchBaseRefs.mockResolvedValue(['origin/develop-old', 'upstream/develop', 'develop'])
    expect(await STORE_COMPANION_CREATION_DEPS.hasBaseRef(repo(), 'origin/develop')).toBe(false)
  })

  it('matches a fully qualified base against the short names the search returns', async () => {
    mocks.searchBaseRefs.mockResolvedValue(['origin/develop'])
    expect(
      await STORE_COMPANION_CREATION_DEPS.hasBaseRef(repo(), 'refs/remotes/origin/develop')
    ).toBe(true)
    expect(mocks.searchBaseRefs.mock.calls[0]?.[2]).toBe('origin/develop')
  })

  it("reads the default the repo's picker shows from its own host", async () => {
    mocks.getBaseRefDefault.mockResolvedValue({ defaultBaseRef: 'origin/master', remoteCount: 1 })
    expect(await STORE_COMPANION_CREATION_DEPS.resolveDefaultBaseRef(remoteRepo)).toBe(
      'origin/master'
    )
    expect(mocks.getBaseRefDefault).toHaveBeenCalledWith(expect.anything(), 'admin', 'ssh:devbox')
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

  async function prepare(launchHostId: 'local' | undefined, submitBaseBranch?: string) {
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
        pendingFirstAgentMessageRename: false,
        submitBaseBranch,
        submitBaseIsPullRequestHead: false
      },
      agentCanReachCompanions: true,
      launchHostId,
      isCancelled: () => false
    })
  }

  beforeEach(() => {
    mocks.getBaseRefDefault.mockResolvedValue({ defaultBaseRef: null, remoteCount: 0 })
    mocks.searchBaseRefs.mockResolvedValue([])
  })

  it('creates the companion from the explicit Create From selection it has', async () => {
    mocks.searchBaseRefs.mockResolvedValue(['origin/develop'])
    await prepare('local', 'origin/develop')
    expect(mocks.getBaseRefDefault).not.toHaveBeenCalled()
    expect(mocks.searchBaseRefs.mock.calls[0]?.[1]).toBe('admin')
    expect(mocks.createWorktree.mock.calls[0]?.[2]).toBe('origin/develop')
  })

  it("creates the companion from the primary's shown default when nothing is selected", async () => {
    mocks.getBaseRefDefault.mockResolvedValue({ defaultBaseRef: 'origin/master', remoteCount: 1 })
    mocks.searchBaseRefs.mockResolvedValue(['origin/master'])
    await prepare('local')
    expect(mocks.getBaseRefDefault.mock.calls[0]?.[1]).toBe('experience')
    expect(mocks.createWorktree.mock.calls[0]?.[2]).toBe('origin/master')
  })

  it('falls back to the companion default when the ref search fails', async () => {
    mocks.searchBaseRefs.mockRejectedValue(new Error('relay gone'))
    const plan = await prepare('local', 'origin/develop')
    expect(mocks.createWorktree.mock.calls[0]?.[2]).toBeUndefined()
    expect(plan.createdCompanions).toEqual([{ repoName: 'admin', branch: 'juan/ax-3448' }])
  })

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
