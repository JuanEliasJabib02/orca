import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Repo } from '../../../../shared/repo-types'
import type { CreateWorktreeResult } from '../../../../shared/worktree/create-types'
import {
  createCompanionWorktrees,
  prepareCompanionWorktrees,
  resolveCompanionRepos,
  type CompanionCreationDeps,
  type CompanionPrimarySubmit,
  type CompanionWorktreeRequest
} from './multi-repo-worktree-creation'
import { summarizeCompanionOutcomes } from './companion-outcome-summary'

const toastMocks = vi.hoisted(() => ({ error: vi.fn(), warning: vi.fn() }))
vi.mock('sonner', () => ({ toast: toastMocks }))

function repo(id: string, overrides: Partial<Repo> = {}): Repo {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: tests only read id, displayName, kind and host fields.
  return {
    id,
    path: `/work/${id}`,
    displayName: id,
    badgeColor: '#111111',
    addedAt: 0,
    ...overrides
  } as Repo
}

function created(repoId: string, branch: string): CreateWorktreeResult {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: orchestration reads only the worktree id, path and branch.
  return {
    worktree: {
      id: `${repoId}::wt`,
      path: `/worktrees/${repoId}/task`,
      branch
    }
  } as CreateWorktreeResult
}

type CreateCall = { repoId: string; request: CompanionWorktreeRequest }

function makeDeps(
  options: {
    failRepoIds?: string[]
    askRepoIds?: string[]
    /** The branch git actually lands on, per repo, e.g. a suffixed pin. */
    branchByRepoId?: Record<string, string>
    /** The refs each repo has; a repo missing here has none. */
    refsByRepoId?: Record<string, string[]>
    /** Repos whose ref lookup throws, as an unreachable host would. */
    uncheckableRepoIds?: string[]
    /** What the primary's picker shows as its detected default. */
    detectedDefaultBaseRef?: string | null | Error
  } = {}
): {
  deps: CompanionCreationDeps
  calls: CreateCall[]
  seeded: string[]
} {
  const calls: CreateCall[] = []
  const seeded: string[] = []
  const deps: CompanionCreationDeps = {
    createWorktree: vi.fn(async (target: Repo, request: CompanionWorktreeRequest) => {
      calls.push({ repoId: target.id, request })
      if (options.failRepoIds?.includes(target.id)) {
        throw new Error(`git worktree add failed in ${target.id}`)
      }
      const branch =
        options.branchByRepoId?.[target.id] ?? request.branchNameOverride ?? 'juan/ax-3448'
      return created(target.id, `refs/heads/${branch}`)
    }),
    resolveSetup: vi.fn(async (target: Repo) =>
      options.askRepoIds?.includes(target.id)
        ? { decision: 'skip' as const, needsUserDecision: true }
        : { decision: 'run' as const, needsUserDecision: false }
    ),
    resolveDefaultBaseRef: vi.fn(async () => {
      if (options.detectedDefaultBaseRef instanceof Error) {
        throw options.detectedDefaultBaseRef
      }
      return options.detectedDefaultBaseRef ?? null
    }),
    hasBaseRef: vi.fn(async (target: Repo, baseRef: string) => {
      if (options.uncheckableRepoIds?.includes(target.id)) {
        throw new Error(`ssh down for ${target.id}`)
      }
      return options.refsByRepoId?.[target.id]?.includes(baseRef) ?? false
    }),
    seedTerminals: vi.fn((result: CreateWorktreeResult) => {
      seeded.push(result.worktree.id)
    })
  }
  return { deps, calls, seeded }
}

const naming = { name: 'ax-3448', displayName: 'AX-3448 Fix login', telemetrySource: undefined }

beforeEach(() => {
  toastMocks.error.mockClear()
  toastMocks.warning.mockClear()
})

describe('createCompanionWorktrees', () => {
  it('creates companions in order and pins the first branch on the rest', async () => {
    const { deps, calls } = makeDeps()
    const result = await createCompanionWorktrees({
      companions: [repo('backend'), repo('admin'), repo('reset')],
      naming,
      branchNameOverride: undefined,
      isCancelled: () => false,
      deps
    })

    expect(calls.map((call) => call.repoId)).toEqual(['backend', 'admin', 'reset'])
    expect(calls[0]?.request.branchNameOverride).toBeUndefined()
    expect(calls[1]?.request.branchNameOverride).toBe('juan/ax-3448')
    expect(calls[2]?.request.branchNameOverride).toBe('juan/ax-3448')
    expect(result.branchName).toBe('juan/ax-3448')
    expect(calls.every((call) => call.request.name === 'ax-3448')).toBe(true)
  })

  it('pins an explicit branch name on every companion', async () => {
    const { deps, calls } = makeDeps()
    await createCompanionWorktrees({
      companions: [repo('backend'), repo('admin')],
      naming,
      branchNameOverride: 'feature/AX-3448',
      isCancelled: () => false,
      deps
    })
    expect(calls.map((call) => call.request.branchNameOverride)).toEqual([
      'feature/AX-3448',
      'feature/AX-3448'
    ])
  })

  it('keeps going after a failure and lets a later repo decide the branch', async () => {
    const { deps, calls, seeded } = makeDeps({ failRepoIds: ['backend'] })
    const result = await createCompanionWorktrees({
      companions: [repo('backend'), repo('admin'), repo('reset')],
      naming,
      branchNameOverride: undefined,
      isCancelled: () => false,
      deps
    })

    expect(result.outcomes.map((outcome) => outcome.status)).toEqual([
      'failed',
      'created',
      'created'
    ])
    expect(calls[2]?.request.branchNameOverride).toBe('juan/ax-3448')
    expect(seeded).toEqual(['admin::wt', 'reset::wt'])
  })

  it('skips setup where the repo would ask, and flags it', async () => {
    const { deps, calls } = makeDeps({ askRepoIds: ['admin'] })
    const result = await createCompanionWorktrees({
      companions: [repo('backend'), repo('admin')],
      naming,
      branchNameOverride: undefined,
      isCancelled: () => false,
      deps
    })
    expect(calls.map((call) => call.request.setupDecision)).toEqual(['run', 'skip'])
    expect(result.outcomes[1]).toMatchObject({ status: 'created', setupNeedsUserDecision: true })
  })

  it('creates nothing when the submit was cancelled before the first companion', async () => {
    const { deps, calls } = makeDeps()
    const result = await createCompanionWorktrees({
      companions: [repo('backend'), repo('admin')],
      naming,
      branchNameOverride: undefined,
      isCancelled: () => true,
      deps
    })
    expect(calls).toEqual([])
    expect(result.outcomes).toEqual([])
  })

  it('finishes the set once a companion exists, even if the submit is dismissed', async () => {
    const { deps, calls } = makeDeps()
    let cancelled = false
    vi.mocked(deps.createWorktree).mockImplementationOnce(async (target, request) => {
      calls.push({ repoId: target.id, request })
      cancelled = true
      return created(target.id, 'refs/heads/juan/ax-3448')
    })
    await createCompanionWorktrees({
      companions: [repo('backend'), repo('admin'), repo('reset')],
      naming,
      branchNameOverride: undefined,
      isCancelled: () => cancelled,
      deps
    })
    expect(calls.map((call) => call.repoId)).toEqual(['backend', 'admin', 'reset'])
  })

  it('creates nothing when the dismissal lands while the first setup check runs', async () => {
    const { deps, calls } = makeDeps()
    let cancelled = false
    vi.mocked(deps.resolveSetup).mockImplementationOnce(async () => {
      cancelled = true
      return { decision: 'run' as const, needsUserDecision: false }
    })
    const result = await createCompanionWorktrees({
      companions: [repo('backend'), repo('admin')],
      naming,
      branchNameOverride: undefined,
      isCancelled: () => cancelled,
      deps
    })
    expect(calls).toEqual([])
    expect(result.outcomes).toEqual([])
  })

  it('still stops on a dismissal while every attempt so far has failed', async () => {
    const { deps, calls } = makeDeps({ failRepoIds: ['backend'] })
    let cancelled = false
    vi.mocked(deps.createWorktree).mockImplementationOnce(async (target, request) => {
      calls.push({ repoId: target.id, request })
      cancelled = true
      throw new Error('git worktree add failed')
    })
    await createCompanionWorktrees({
      companions: [repo('backend'), repo('admin')],
      naming,
      branchNameOverride: undefined,
      isCancelled: () => cancelled,
      deps
    })
    expect(calls.map((call) => call.repoId)).toEqual(['backend'])
  })

  it('flags a companion that git put on a suffixed branch instead of the pin', async () => {
    const { deps } = makeDeps({ branchByRepoId: { admin: 'juan/ax-3448-2' } })
    const result = await createCompanionWorktrees({
      companions: [repo('backend'), repo('admin')],
      naming,
      branchNameOverride: undefined,
      isCancelled: () => false,
      deps
    })
    expect(result.outcomes[0]).not.toHaveProperty('expectedBranch')
    expect(result.outcomes[1]).toMatchObject({
      status: 'created',
      branch: 'juan/ax-3448-2',
      expectedBranch: 'juan/ax-3448'
    })
    expect(result.branchName).toBe('juan/ax-3448')
  })

  it('flags the first companion too when an explicit branch was pinned', async () => {
    const { deps } = makeDeps({ branchByRepoId: { backend: 'feature/AX-3448-2' } })
    const result = await createCompanionWorktrees({
      companions: [repo('backend')],
      naming,
      branchNameOverride: 'feature/AX-3448',
      isCancelled: () => false,
      deps
    })
    expect(result.outcomes[0]).toMatchObject({ expectedBranch: 'feature/AX-3448' })
  })

  it("branches every companion that has the primary's base from it", async () => {
    const { deps, calls } = makeDeps({
      refsByRepoId: { backend: ['origin/develop'], admin: ['origin/develop', 'origin/main'] }
    })
    const result = await createCompanionWorktrees({
      companions: [repo('backend'), repo('admin')],
      naming,
      branchNameOverride: undefined,
      baseBranch: 'origin/develop',
      isCancelled: () => false,
      deps
    })
    expect(calls.map((call) => call.request.baseBranch)).toEqual([
      'origin/develop',
      'origin/develop'
    ])
    expect(deps.hasBaseRef).toHaveBeenCalledWith(repo('admin'), 'origin/develop')
    expect(result.outcomes.every((outcome) => !('baseFallback' in outcome))).toBe(true)
  })

  it('falls back to the default base of a repo without that ref, and records why', async () => {
    const { deps, calls } = makeDeps({ refsByRepoId: { backend: ['origin/develop'] } })
    const result = await createCompanionWorktrees({
      companions: [repo('backend'), repo('reset')],
      naming,
      branchNameOverride: undefined,
      baseBranch: 'origin/develop',
      isCancelled: () => false,
      deps
    })
    expect(calls[0]?.request.baseBranch).toBe('origin/develop')
    expect(calls[1]?.request).not.toHaveProperty('baseBranch')
    expect(result.outcomes[1]).toMatchObject({
      status: 'created',
      baseFallback: { requested: 'origin/develop', reason: 'missing' }
    })
  })

  it('falls back instead of failing when the ref check cannot run', async () => {
    const { deps, calls } = makeDeps({ uncheckableRepoIds: ['admin'] })
    const result = await createCompanionWorktrees({
      companions: [repo('admin')],
      naming,
      branchNameOverride: undefined,
      baseBranch: 'origin/develop',
      isCancelled: () => false,
      deps
    })
    expect(calls[0]?.request).not.toHaveProperty('baseBranch')
    expect(result.outcomes[0]).toMatchObject({
      status: 'created',
      baseFallback: { requested: 'origin/develop', reason: 'unchecked' }
    })
  })

  it('leaves every companion on its own default when the primary has no base', async () => {
    const { deps, calls } = makeDeps()
    const result = await createCompanionWorktrees({
      companions: [repo('backend')],
      naming,
      branchNameOverride: undefined,
      isCancelled: () => false,
      deps
    })
    expect(deps.hasBaseRef).not.toHaveBeenCalled()
    expect(calls[0]?.request).not.toHaveProperty('baseBranch')
    expect(result.outcomes[0]).not.toHaveProperty('baseFallback')
  })

  it('creates nothing when the dismissal lands while the base check runs', async () => {
    const { deps, calls } = makeDeps({ refsByRepoId: { backend: ['origin/develop'] } })
    let cancelled = false
    vi.mocked(deps.hasBaseRef).mockImplementationOnce(async () => {
      cancelled = true
      return true
    })
    await createCompanionWorktrees({
      companions: [repo('backend')],
      naming,
      branchNameOverride: undefined,
      baseBranch: 'origin/develop',
      isCancelled: () => cancelled,
      deps
    })
    expect(calls).toEqual([])
  })
})

describe('resolveCompanionRepos', () => {
  it('keeps selected git repos on the primary host, in selection order', () => {
    const primary = repo('backend')
    const repos = [
      primary,
      repo('admin'),
      repo('reset'),
      repo('notes', { kind: 'folder' }),
      repo('remote', { connectionId: 'devbox' })
    ]
    expect(
      resolveCompanionRepos(
        ['reset', 'admin', 'backend', 'notes', 'remote', 'gone', 'admin'],
        repos,
        primary
      ).map((entry) => entry.id)
    ).toEqual(['reset', 'admin'])
  })
})

describe('summarizeCompanionOutcomes', () => {
  it('reports nothing when every companion was created with its setup', () => {
    expect(
      summarizeCompanionOutcomes([
        {
          status: 'created',
          repo: repo('admin'),
          worktreeId: 'admin::wt',
          path: '/w/admin',
          branch: 'b',
          setupNeedsUserDecision: false
        }
      ])
    ).toBeNull()
  })

  it('lists failures and skipped setups in one error', () => {
    const summary = summarizeCompanionOutcomes([
      { status: 'failed', repo: repo('backend'), error: 'branch already checked out' },
      {
        status: 'created',
        repo: repo('admin'),
        worktreeId: 'admin::wt',
        path: '/w/admin',
        branch: 'b',
        setupNeedsUserDecision: true
      }
    ])
    expect(summary?.kind).toBe('error')
    expect(summary?.description).toContain('backend: branch already checked out')
    expect(summary?.description).toContain('admin')
  })

  it('warns about a companion off the shared branch', () => {
    const summary = summarizeCompanionOutcomes([
      {
        status: 'created',
        repo: repo('admin-action'),
        worktreeId: 'admin-action::wt',
        path: '/w/admin-action',
        branch: 'AX-3448-2',
        expectedBranch: 'AX-3448',
        setupNeedsUserDecision: false
      }
    ])
    expect(summary).toEqual({
      kind: 'warning',
      title: 'Some companion worktrees are on a different branch',
      description: 'admin-action is on AX-3448-2 instead of AX-3448'
    })
  })

  it('keeps a failure as the headline when a companion is also off the branch', () => {
    const summary = summarizeCompanionOutcomes([
      { status: 'failed', repo: repo('backend'), error: 'boom' },
      {
        status: 'created',
        repo: repo('admin'),
        worktreeId: 'admin::wt',
        path: '/w/admin',
        branch: 'b-2',
        expectedBranch: 'b',
        setupNeedsUserDecision: false
      }
    ])
    expect(summary?.kind).toBe('error')
    expect(summary?.title).toBe('Some companion worktrees were not created')
    expect(summary?.description).toBe('backend: boom\nadmin is on b-2 instead of b')
  })

  it('warns about companions created from their own default base, with the reason', () => {
    const summary = summarizeCompanionOutcomes([
      {
        status: 'created',
        repo: repo('reset'),
        worktreeId: 'reset::wt',
        path: '/w/reset',
        branch: 'b',
        baseFallback: { requested: 'origin/develop', reason: 'missing' },
        setupNeedsUserDecision: false
      },
      {
        status: 'created',
        repo: repo('admin'),
        worktreeId: 'admin::wt',
        path: '/w/admin',
        branch: 'b',
        baseFallback: { requested: 'origin/develop', reason: 'unchecked' },
        setupNeedsUserDecision: false
      }
    ])
    expect(summary).toEqual({
      kind: 'warning',
      title: 'Some companion worktrees were created from their default base',
      description:
        'reset: no origin/develop, created from its default base\n' +
        'admin: could not check origin/develop, created from its default base'
    })
  })
})

describe('prepareCompanionWorktrees', () => {
  const primary = repo('experience')
  const repos = [primary, repo('backend'), repo('admin'), repo('reset')]

  function primarySubmit(overrides: Partial<CompanionPrimarySubmit>): CompanionPrimarySubmit {
    return {
      agent: 'claude',
      workspaceName: 'ax-3448',
      createDisplayName: 'AX-3448 Fix login',
      nameIsAutoManaged: false,
      nameWasGenerated: false,
      effectiveBranchNameOverride: undefined,
      pendingFirstAgentMessageRename: false,
      submitBaseBranch: undefined,
      submitBaseIsPullRequestHead: false,
      ...overrides
    }
  }

  it('returns the shared branch and every created path for an add-dir agent', async () => {
    const { deps } = makeDeps({ failRepoIds: ['admin'] })
    const plan = await prepareCompanionWorktrees({
      submit: { repoIds: ['backend', 'admin', 'reset'], grantAgentAccess: true },
      repos,
      primaryRepo: primary,
      primary: primarySubmit({ agent: 'claude', pendingFirstAgentMessageRename: true }),
      agentCanReachCompanions: true,
      launchReadsAgentArgs: true,
      isCancelled: () => false,
      deps
    })

    expect(plan).toEqual({
      addDirPaths: ['/worktrees/backend/task', '/worktrees/reset/task'],
      branchNameOverride: 'juan/ax-3448',
      pendingFirstAgentMessageRename: false,
      createdCompanions: [
        { repoName: 'backend', branch: 'juan/ax-3448' },
        { repoName: 'reset', branch: 'juan/ax-3448' }
      ]
    })
    expect(toastMocks.error).toHaveBeenCalledTimes(1)
  })

  it('names companions after the primary, with its status and telemetry', async () => {
    const { deps, calls } = makeDeps()
    await prepareCompanionWorktrees({
      submit: { repoIds: ['backend'], grantAgentAccess: true },
      repos,
      primaryRepo: primary,
      primary: primarySubmit({ effectiveBranchNameOverride: 'feature/AX-3448' }),
      agentCanReachCompanions: true,
      launchReadsAgentArgs: true,
      workspaceStatus: 'in-progress',
      telemetrySource: 'sidebar',
      isCancelled: () => false,
      deps
    })
    expect(calls[0]?.request).toEqual({
      name: 'ax-3448',
      displayName: 'AX-3448 Fix login',
      displayNameKind: 'user',
      nameWasGenerated: false,
      workspaceStatus: 'in-progress',
      telemetrySource: 'sidebar',
      setupDecision: 'run',
      branchNameOverride: 'feature/AX-3448'
    })
  })

  it('withholds access when the agent cannot reach the companion paths', async () => {
    const { deps } = makeDeps()
    const plan = await prepareCompanionWorktrees({
      submit: { repoIds: ['backend'], grantAgentAccess: true },
      repos,
      primaryRepo: primary,
      primary: primarySubmit({}),
      agentCanReachCompanions: false,
      launchReadsAgentArgs: true,
      isCancelled: () => false,
      deps
    })
    expect(plan.addDirPaths).toEqual([])
  })

  it('creates companions without granting access when the box is unchecked', async () => {
    const { deps, calls } = makeDeps()
    const plan = await prepareCompanionWorktrees({
      submit: { repoIds: ['backend'], grantAgentAccess: false },
      repos,
      primaryRepo: primary,
      primary: primarySubmit({ agent: 'claude', pendingFirstAgentMessageRename: false }),
      agentCanReachCompanions: true,
      launchReadsAgentArgs: true,
      isCancelled: () => false,
      deps
    })
    expect(calls).toHaveLength(1)
    expect(plan.addDirPaths).toEqual([])
    expect(toastMocks.error).not.toHaveBeenCalled()
  })

  it('grants nothing to an agent without `--add-dir`', async () => {
    const { deps } = makeDeps()
    const plan = await prepareCompanionWorktrees({
      submit: { repoIds: ['backend'], grantAgentAccess: true },
      repos,
      primaryRepo: primary,
      primary: primarySubmit({ agent: 'gemini', pendingFirstAgentMessageRename: false }),
      agentCanReachCompanions: true,
      launchReadsAgentArgs: true,
      isCancelled: () => false,
      deps
    })
    expect(plan.addDirPaths).toEqual([])
  })

  it('leaves the primary untouched when no companion is selected', async () => {
    const { deps, calls } = makeDeps()
    const plan = await prepareCompanionWorktrees({
      submit: { repoIds: [], grantAgentAccess: true },
      repos,
      primaryRepo: primary,
      primary: primarySubmit({ agent: 'claude', pendingFirstAgentMessageRename: true }),
      agentCanReachCompanions: true,
      launchReadsAgentArgs: true,
      isCancelled: () => false,
      deps
    })
    expect(calls).toHaveLength(0)
    expect(plan).toEqual({
      addDirPaths: [],
      branchNameOverride: undefined,
      pendingFirstAgentMessageRename: true,
      createdCompanions: []
    })
  })

  it('grants nothing when the launch route reads no CLI args, but still creates', async () => {
    const { deps, calls } = makeDeps()
    const plan = await prepareCompanionWorktrees({
      submit: { repoIds: ['backend'], grantAgentAccess: true },
      repos,
      primaryRepo: primary,
      primary: primarySubmit({ agent: 'claude' }),
      agentCanReachCompanions: true,
      launchReadsAgentArgs: false,
      isCancelled: () => false,
      deps
    })
    expect(calls).toHaveLength(1)
    expect(plan.addDirPaths).toEqual([])
    expect(plan.createdCompanions).toEqual([{ repoName: 'backend', branch: 'juan/ax-3448' }])
  })

  it('lists an off-branch companion in the summary toast', async () => {
    const { deps } = makeDeps({ branchByRepoId: { admin: 'feature/AX-3448-2' } })
    await prepareCompanionWorktrees({
      submit: { repoIds: ['backend', 'admin'], grantAgentAccess: true },
      repos,
      primaryRepo: primary,
      primary: primarySubmit({ effectiveBranchNameOverride: 'feature/AX-3448' }),
      agentCanReachCompanions: true,
      launchReadsAgentArgs: true,
      isCancelled: () => false,
      deps
    })
    expect(toastMocks.warning).toHaveBeenCalledWith(
      'Some companion worktrees are on a different branch',
      { description: 'admin is on feature/AX-3448-2 instead of feature/AX-3448' }
    )
  })

  async function prepareWithBase(
    deps: CompanionCreationDeps,
    overrides: { primaryRepo?: Repo; submitBaseBranch?: string; prHead?: boolean } = {}
  ) {
    return prepareCompanionWorktrees({
      submit: { repoIds: ['backend', 'reset'], grantAgentAccess: true },
      repos,
      primaryRepo: overrides.primaryRepo ?? primary,
      primary: primarySubmit({
        submitBaseBranch: overrides.submitBaseBranch,
        submitBaseIsPullRequestHead: overrides.prHead ?? false
      }),
      agentCanReachCompanions: true,
      launchReadsAgentArgs: true,
      isCancelled: () => false,
      deps
    })
  }

  it('branches companions from the explicit Create From selection', async () => {
    const { deps, calls } = makeDeps({
      refsByRepoId: { backend: ['origin/develop'], reset: ['origin/develop'] },
      detectedDefaultBaseRef: 'origin/master'
    })
    await prepareWithBase(deps, { submitBaseBranch: 'origin/develop' })
    expect(deps.resolveDefaultBaseRef).not.toHaveBeenCalled()
    expect(calls.map((call) => call.request.baseBranch)).toEqual([
      'origin/develop',
      'origin/develop'
    ])
    expect(toastMocks.warning).not.toHaveBeenCalled()
  })

  it("uses the primary's default, not a pull request head, when the start point is a PR", async () => {
    const { deps, calls } = makeDeps({
      refsByRepoId: { backend: ['develop'], reset: ['develop'] },
      detectedDefaultBaseRef: 'origin/master'
    })
    await prepareWithBase(deps, {
      primaryRepo: repo('experience', { worktreeBaseRef: 'develop' }),
      submitBaseBranch: 'pull/42/head',
      prHead: true
    })
    expect(calls.map((call) => call.request.baseBranch)).toEqual(['develop', 'develop'])
    expect(toastMocks.warning).not.toHaveBeenCalled()
  })

  it("branches companions from the primary's configured default when nothing is selected", async () => {
    const { deps, calls } = makeDeps({
      refsByRepoId: { backend: ['develop'], reset: ['develop'] },
      detectedDefaultBaseRef: 'origin/master'
    })
    await prepareWithBase(deps, { primaryRepo: repo('experience', { worktreeBaseRef: 'develop' }) })
    expect(deps.resolveDefaultBaseRef).not.toHaveBeenCalled()
    expect(calls.map((call) => call.request.baseBranch)).toEqual(['develop', 'develop'])
  })

  it("branches companions from the primary's detected default when nothing is configured", async () => {
    const { deps, calls } = makeDeps({
      refsByRepoId: { backend: ['origin/master'], reset: ['origin/master'] },
      detectedDefaultBaseRef: 'origin/master'
    })
    await prepareWithBase(deps)
    expect(deps.resolveDefaultBaseRef).toHaveBeenCalledWith(primary)
    expect(calls.map((call) => call.request.baseBranch)).toEqual(['origin/master', 'origin/master'])
  })

  it('lists a companion without the base in the summary toast', async () => {
    const { deps, calls } = makeDeps({ refsByRepoId: { backend: ['origin/develop'] } })
    await prepareWithBase(deps, { submitBaseBranch: 'origin/develop' })
    expect(calls[1]?.request).not.toHaveProperty('baseBranch')
    expect(toastMocks.warning).toHaveBeenCalledWith(
      'Some companion worktrees were created from their default base',
      { description: 'reset: no origin/develop, created from its default base' }
    )
  })

  it('keeps companions on their own defaults when the primary default cannot be read', async () => {
    const { deps, calls } = makeDeps({ detectedDefaultBaseRef: new Error('ssh down') })
    const plan = await prepareWithBase(deps)
    expect(deps.hasBaseRef).not.toHaveBeenCalled()
    expect(calls.every((call) => !('baseBranch' in call.request))).toBe(true)
    expect(plan.createdCompanions).toHaveLength(2)
    expect(toastMocks.warning).not.toHaveBeenCalled()
  })
})
