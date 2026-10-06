import { beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import type { SpotlightOpResult } from '../../../../../../shared/spotlight'
import {
  notifyTaskSpotlightBatch,
  runTaskSpotlightBatch,
  type TaskSpotlightActions
} from './task-spotlight-batch'
import { resolveTaskSpotlightMembers } from './task-spotlight-members'
import {
  OP_FAILED,
  OP_OK,
  holdersByRepo,
  makeSpotlightRepo,
  makeTaskWorktree
} from './task-spotlight-test-fixtures'

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() }
}))

const REPOS = ['backend', 'admin', 'docs'].map((id) => makeSpotlightRepo(id))
const { eligible: MEMBERS } = resolveTaskSpotlightMembers(
  [
    { worktreeId: 'be-1', repoId: 'backend' },
    { worktreeId: 'ad-1', repoId: 'admin' },
    { worktreeId: 'dc-1', repoId: 'docs' }
  ],
  {
    backend: [makeTaskWorktree('be-1', 'backend')],
    admin: [makeTaskWorktree('ad-1', 'admin')],
    docs: [makeTaskWorktree('dc-1', 'docs')]
  },
  REPOS
)

type OpOptions = { quiet?: boolean; projectName?: string }

function makeActions(
  results: Partial<Record<string, SpotlightOpResult | Error>> = {}
): TaskSpotlightActions & { calls: string[] } {
  const calls: string[] = []
  const settle = async (repoId: string): Promise<SpotlightOpResult> => {
    const result = results[repoId] ?? OP_OK
    if (result instanceof Error) {
      throw result
    }
    return result
  }
  return {
    calls,
    activateSpotlight: vi.fn(async (repoId: string, worktreeId: string, opts?: OpOptions) => {
      calls.push(`on:${repoId}:${worktreeId}:${opts?.quiet}`)
      return settle(repoId)
    }),
    deactivateSpotlight: vi.fn(async (repoId: string, opts?: OpOptions) => {
      calls.push(`off:${repoId}:${opts?.quiet}`)
      return settle(repoId)
    })
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('runTaskSpotlightBatch', () => {
  it('turns Spotlight on quietly for every project, one after another', async () => {
    const actions = makeActions()
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    vi.mocked(actions.activateSpotlight).mockImplementationOnce(
      async (repoId, worktreeId, opts) => {
        actions.calls.push(`on:${repoId}:${worktreeId}:${opts?.quiet}`)
        await gate
        return OP_OK
      }
    )

    const running = runTaskSpotlightBatch({ members: MEMBERS, spotlightByRepo: {}, actions })
    await Promise.resolve()
    expect(actions.calls).toEqual(['on:backend:be-1:true'])

    release()
    const result = await running

    expect(actions.calls).toEqual([
      'on:backend:be-1:true',
      'on:admin:ad-1:true',
      'on:docs:dc-1:true'
    ])
    expect(result).toEqual({ mode: 'on', total: 3, succeeded: 3 })
  })

  it('does not touch projects that already hold the task and still counts them', async () => {
    const actions = makeActions()

    const result = await runTaskSpotlightBatch({
      members: MEMBERS,
      spotlightByRepo: holdersByRepo({ backend: 'be-1' }),
      actions
    })

    expect(actions.calls).toEqual(['on:admin:ad-1:true', 'on:docs:dc-1:true'])
    expect(result).toEqual({ mode: 'on', total: 3, succeeded: 3 })
  })

  it('takes a project over from another workspace when it holds something else', async () => {
    const actions = makeActions()

    await runTaskSpotlightBatch({
      members: MEMBERS,
      spotlightByRepo: holdersByRepo({ backend: 'someone-else', admin: 'ad-1', docs: 'dc-1' }),
      actions
    })

    expect(actions.calls).toEqual(['on:backend:be-1:true'])
  })

  it('keeps going after a project fails and reports what succeeded', async () => {
    const actions = makeActions({ backend: OP_FAILED })

    const result = await runTaskSpotlightBatch({ members: MEMBERS, spotlightByRepo: {}, actions })

    expect(actions.calls).toHaveLength(3)
    expect(result).toEqual({ mode: 'on', total: 3, succeeded: 2 })
  })

  it('treats a rejected call as a failure, toasts it and keeps going', async () => {
    const actions = makeActions({ admin: new Error('ipc closed') })

    const result = await runTaskSpotlightBatch({ members: MEMBERS, spotlightByRepo: {}, actions })

    expect(actions.calls).toHaveLength(3)
    expect(result).toEqual({ mode: 'on', total: 3, succeeded: 2 })
    expect(toast.error).toHaveBeenCalledWith('Failed to start Spotlight in admin', {
      description: 'ipc closed'
    })
  })

  it('names each project so the store titles its failure toast with it', async () => {
    const actions = makeActions()

    await runTaskSpotlightBatch({ members: MEMBERS, spotlightByRepo: {}, actions })
    await runTaskSpotlightBatch({
      members: MEMBERS,
      spotlightByRepo: holdersByRepo({ backend: 'be-1', admin: 'ad-1', docs: 'dc-1' }),
      actions
    })

    expect(actions.activateSpotlight).toHaveBeenCalledWith('backend', 'be-1', {
      quiet: true,
      projectName: 'backend'
    })
    expect(actions.deactivateSpotlight).toHaveBeenCalledWith('docs', {
      quiet: true,
      projectName: 'docs'
    })
  })

  it('turns Spotlight off quietly in the projects holding the task when already lit', async () => {
    const actions = makeActions()

    const result = await runTaskSpotlightBatch({
      members: MEMBERS,
      spotlightByRepo: holdersByRepo({ backend: 'be-1', admin: 'ad-1', docs: 'dc-1' }),
      actions
    })

    expect(actions.calls).toEqual(['off:backend:true', 'off:admin:true', 'off:docs:true'])
    expect(result).toEqual({ mode: 'off', total: 3, succeeded: 3 })
  })

  it('keeps turning off after a failure', async () => {
    const actions = makeActions({ backend: new Error('boom'), admin: OP_FAILED })

    const result = await runTaskSpotlightBatch({
      members: MEMBERS,
      spotlightByRepo: holdersByRepo({ backend: 'be-1', admin: 'ad-1', docs: 'dc-1' }),
      actions
    })

    expect(actions.calls).toHaveLength(3)
    expect(result).toEqual({ mode: 'off', total: 3, succeeded: 1 })
    expect(toast.error).toHaveBeenCalledWith('Failed to turn off Spotlight in backend', {
      description: 'boom'
    })
  })

  it('does nothing without members', async () => {
    const actions = makeActions()

    const result = await runTaskSpotlightBatch({ members: [], spotlightByRepo: {}, actions })

    expect(actions.calls).toEqual([])
    expect(result).toEqual({ mode: 'on', total: 0, succeeded: 0 })
  })
})

describe('notifyTaskSpotlightBatch', () => {
  it('confirms a complete turn-on with one success toast', () => {
    notifyTaskSpotlightBatch('AX-3448', { mode: 'on', total: 3, succeeded: 3 })

    expect(toast.success).toHaveBeenCalledTimes(1)
    expect(toast.success).toHaveBeenCalledWith('Spotlight on for AX-3448')
    expect(toast.warning).not.toHaveBeenCalled()
  })

  it('confirms a complete turn-off with one success toast', () => {
    notifyTaskSpotlightBatch('AX-3448', { mode: 'off', total: 2, succeeded: 2 })

    expect(toast.success).toHaveBeenCalledWith('Spotlight off for AX-3448')
  })

  it('summarizes a partial turn-on as a warning with the counts', () => {
    notifyTaskSpotlightBatch('AX-3448', { mode: 'on', total: 4, succeeded: 3 })

    expect(toast.warning).toHaveBeenCalledWith('Spotlight on for 3 of 4 projects')
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('summarizes a partial turn-off as a warning with the counts', () => {
    notifyTaskSpotlightBatch('AX-3448', { mode: 'off', total: 2, succeeded: 1 })

    expect(toast.warning).toHaveBeenCalledWith('Spotlight off for 1 of 2 projects')
  })

  it('stays quiet when nothing succeeded, since each failure toasted already', () => {
    notifyTaskSpotlightBatch('AX-3448', { mode: 'on', total: 2, succeeded: 0 })
    notifyTaskSpotlightBatch('AX-3448', { mode: 'on', total: 0, succeeded: 0 })

    expect(toast.success).not.toHaveBeenCalled()
    expect(toast.warning).not.toHaveBeenCalled()
  })
})
