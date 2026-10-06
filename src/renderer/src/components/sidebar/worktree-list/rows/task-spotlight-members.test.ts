import { describe, expect, it } from 'vitest'
import { isTaskSpotlightLit, resolveTaskSpotlightMembers } from './task-spotlight-members'
import { holdersByRepo, makeSpotlightRepo, makeTaskWorktree } from './task-spotlight-test-fixtures'

const BACKEND = makeSpotlightRepo('backend')
const ADMIN = makeSpotlightRepo('admin')

describe('resolveTaskSpotlightMembers', () => {
  it('takes one worktree per project from the task', () => {
    const { eligible, spotlightOffRepos } = resolveTaskSpotlightMembers(
      [
        { worktreeId: 'be-1', repoId: 'backend' },
        { worktreeId: 'ad-1', repoId: 'admin' }
      ],
      {
        backend: [makeTaskWorktree('be-1', 'backend')],
        admin: [makeTaskWorktree('ad-1', 'admin')]
      },
      [BACKEND, ADMIN]
    )

    expect(eligible.map((member) => [member.repo.id, member.worktree.id])).toEqual([
      ['backend', 'be-1'],
      ['admin', 'ad-1']
    ])
    expect(spotlightOffRepos).toEqual([])
  })

  it('picks the most recently active worktree when a project has several in the task', () => {
    const { eligible } = resolveTaskSpotlightMembers(
      [
        { worktreeId: 'be-old', repoId: 'backend' },
        { worktreeId: 'be-new', repoId: 'backend' },
        { worktreeId: 'be-mid', repoId: 'backend' }
      ],
      {
        backend: [
          makeTaskWorktree('be-old', 'backend', { lastActivityAt: 10 }),
          makeTaskWorktree('be-new', 'backend', { lastActivityAt: 30 }),
          makeTaskWorktree('be-mid', 'backend', { lastActivityAt: 20 })
        ]
      },
      [BACKEND]
    )

    expect(eligible).toHaveLength(1)
    expect(eligible[0].worktree.id).toBe('be-new')
    expect(eligible[0].taskWorktreeIds).toEqual(['be-old', 'be-new', 'be-mid'])
  })

  it('keeps the first listed worktree on an activity tie', () => {
    const { eligible } = resolveTaskSpotlightMembers(
      [
        { worktreeId: 'be-a', repoId: 'backend' },
        { worktreeId: 'be-b', repoId: 'backend' }
      ],
      {
        backend: [
          makeTaskWorktree('be-a', 'backend', { lastActivityAt: 5 }),
          makeTaskWorktree('be-b', 'backend', { lastActivityAt: 5 })
        ]
      },
      [BACKEND]
    )

    expect(eligible[0].worktree.id).toBe('be-a')
  })

  it('skips main worktrees, SSH projects, folder projects and unknown members without listing them', () => {
    const ssh = makeSpotlightRepo('ssh', { connectionId: 'gpu-vm' })
    const folder = makeSpotlightRepo('folder', { kind: 'folder' })
    const { eligible, spotlightOffRepos } = resolveTaskSpotlightMembers(
      [
        { worktreeId: 'be-main', repoId: 'backend' },
        { worktreeId: 'ssh-1', repoId: 'ssh' },
        { worktreeId: 'folder-1', repoId: 'folder' },
        { worktreeId: 'ghost', repoId: 'backend' },
        { worktreeId: 'lost-1', repoId: 'lost' }
      ],
      {
        backend: [makeTaskWorktree('be-main', 'backend', { isMainWorktree: true })],
        ssh: [makeTaskWorktree('ssh-1', 'ssh')],
        folder: [makeTaskWorktree('folder-1', 'folder')],
        lost: [makeTaskWorktree('lost-1', 'lost')]
      },
      [BACKEND, ssh, folder]
    )

    expect(eligible).toEqual([])
    expect(spotlightOffRepos).toEqual([])
  })

  it('lists a project once when only its Spotlight setting keeps its worktrees out', () => {
    const off = makeSpotlightRepo('legacy', { spotlightTestingEnabled: false })
    const unset = makeSpotlightRepo('unset', { spotlightTestingEnabled: undefined })
    const offSsh = makeSpotlightRepo('off-ssh', {
      spotlightTestingEnabled: false,
      connectionId: 'gpu-vm'
    })
    const { eligible, spotlightOffRepos } = resolveTaskSpotlightMembers(
      [
        { worktreeId: 'lg-1', repoId: 'legacy' },
        { worktreeId: 'lg-2', repoId: 'legacy' },
        { worktreeId: 'un-1', repoId: 'unset' },
        { worktreeId: 'os-1', repoId: 'off-ssh' },
        { worktreeId: 'be-1', repoId: 'backend' }
      ],
      {
        legacy: [makeTaskWorktree('lg-1', 'legacy'), makeTaskWorktree('lg-2', 'legacy')],
        unset: [makeTaskWorktree('un-1', 'unset')],
        'off-ssh': [makeTaskWorktree('os-1', 'off-ssh')],
        backend: [makeTaskWorktree('be-1', 'backend')]
      },
      [off, unset, offSsh, BACKEND]
    )

    expect(eligible.map((member) => member.repo.id)).toEqual(['backend'])
    expect(spotlightOffRepos.map((repo) => repo.id)).toEqual(['legacy', 'unset'])
  })
})

describe('isTaskSpotlightLit', () => {
  const { eligible } = resolveTaskSpotlightMembers(
    [
      { worktreeId: 'be-1', repoId: 'backend' },
      { worktreeId: 'be-2', repoId: 'backend' },
      { worktreeId: 'ad-1', repoId: 'admin' }
    ],
    {
      backend: [
        makeTaskWorktree('be-1', 'backend', { lastActivityAt: 1 }),
        makeTaskWorktree('be-2', 'backend', { lastActivityAt: 2 })
      ],
      admin: [makeTaskWorktree('ad-1', 'admin')]
    },
    [BACKEND, ADMIN]
  )

  it('is lit when every eligible project holds a worktree of the task', () => {
    expect(isTaskSpotlightLit(eligible, holdersByRepo({ backend: 'be-2', admin: 'ad-1' }))).toBe(
      true
    )
  })

  it('counts any task worktree of the project as holding, not only the most recent one', () => {
    expect(isTaskSpotlightLit(eligible, holdersByRepo({ backend: 'be-1', admin: 'ad-1' }))).toBe(
      true
    )
  })

  it('is unlit when one project is off or held by a worktree outside the task', () => {
    expect(isTaskSpotlightLit(eligible, holdersByRepo({ backend: 'be-2' }))).toBe(false)
    expect(isTaskSpotlightLit(eligible, holdersByRepo({ backend: 'be-2', admin: 'other' }))).toBe(
      false
    )
    expect(isTaskSpotlightLit(eligible, undefined)).toBe(false)
  })

  it('is never lit without eligible projects', () => {
    expect(isTaskSpotlightLit([], holdersByRepo({ backend: 'be-2' }))).toBe(false)
  })
})
