import { describe, expect, it } from 'vitest'
import { computeVisibleWorktreeIds } from './visible-worktrees'
import type { SidebarSpaceScope } from './sidebar-space-scope'
import type { Repo } from '../../../../shared/repo-types'
import type { Worktree } from '../../../../shared/worktree/types'
import { LOCAL_EXECUTION_HOST_ID } from '../../../../shared/execution-host'

function makeWorktree(id: string, repoId: string, overrides: Partial<Worktree> = {}): Worktree {
  return {
    id,
    repoId,
    path: `/tmp/${id}`,
    head: 'abc123',
    branch: 'refs/heads/feature',
    isBare: false,
    isMainWorktree: false,
    displayName: id,
    comment: '',
    linkedIssue: null,
    linkedPR: null,
    linkedLinearIssue: null,
    isArchived: false,
    isUnread: false,
    isPinned: false,
    sortOrder: 0,
    lastActivityAt: 0,
    ...overrides
  }
}

function makeRoot(id: string, repoId: string, overrides: Partial<Worktree> = {}): Worktree {
  return makeWorktree(id, repoId, { isMainWorktree: true, branch: 'refs/heads/main', ...overrides })
}

function makeRepo(id: string, overrides: Partial<Repo> = {}): Repo {
  return { id, path: `/${id}`, displayName: id, badgeColor: '#000', addedAt: 0, ...overrides }
}

const repoMap = new Map<string, Repo>([
  ['web', makeRepo('web')],
  ['api', makeRepo('api')],
  ['remote', makeRepo('remote', { connectionId: 'box' })],
  ['notes', makeRepo('notes', { kind: 'folder' })],
  ['home', makeRepo('home')]
])

// Why the provenance: each content filter must have a root of its own to drop.
const webRoot = makeRoot('web-root', 'web', {
  automationProvenance: {
    kind: 'created-by-automation',
    automationId: 'nightly',
    automationNameSnapshot: 'Nightly',
    automationRunId: 'run-1',
    automationRunTitleSnapshot: 'Run 1',
    createdAt: 0,
    executionTargetType: 'local',
    executionTargetId: 'local',
    projectId: 'web'
  }
})
const apiRoot = makeRoot('api-root', 'api', {
  cliProvenance: { kind: 'created-by-cli', createdAt: 0 }
})
const remoteRoot = makeRoot('remote-root', 'remote', { branch: '' })
const homeRoot = makeRoot('home-root', 'home', {
  creatorProvenance: { kind: 'paired-device', deviceId: 'phone' }
})
const notesRoot = makeRoot('notes-root', 'notes', { branch: '' })
const webFeature = makeWorktree('web-feature', 'web')

const worktreesByRepo = {
  web: [webRoot, webFeature],
  api: [apiRoot],
  remote: [remoteRoot],
  notes: [notesRoot],
  home: [homeRoot]
}
const sortedIds = ['web-feature', 'web-root', 'api-root', 'remote-root', 'notes-root', 'home-root']
const GIT_ROOTS = ['web-root', 'api-root', 'remote-root', 'home-root']

type VisibleOptions = Parameters<typeof computeVisibleWorktreeIds>[2]

function visibleIds(
  overrides: Partial<VisibleOptions>,
  byRepo: Record<string, Worktree[]> = worktreesByRepo
): string[] {
  return computeVisibleWorktreeIds(byRepo, sortedIds, {
    filterRepoIds: [],
    showSleepingWorkspaces: true,
    tabsByWorktree: {},
    ptyIdsByTabId: {},
    browserTabsByWorktree: {},
    worktreeIdsWithLiveAgent: new Set(),
    hideDefaultBranchWorkspace: false,
    hideAutomationGeneratedWorkspaces: false,
    hideCliCreatedWorkspaces: false,
    hideDetachedHeadWorkspaces: false,
    hideWorkspacesFromOtherDevices: false,
    pairedDeviceIdsByEnvironment: new Map(),
    repoMap,
    workspaceHostScope: 'all',
    defaultHostId: LOCAL_EXECUTION_HOST_ID,
    worktreeLineageById: {},
    ...overrides
  })
}

function keptRoots(ids: readonly string[]): string[] {
  return GIT_ROOTS.filter((id) => ids.includes(id))
}

describe('computeVisibleWorktrees keeping the Servers roots (Group by → Task)', () => {
  const filters: [string, Partial<VisibleOptions>][] = [
    ['hide default branch', { hideDefaultBranchWorkspace: true }],
    ['hide sleeping', { showSleepingWorkspaces: false, alwaysShowDefaultBranchWorkspace: false }],
    ['hide detached HEAD', { hideDetachedHeadWorkspaces: true }],
    ['hide automation-created', { hideAutomationGeneratedWorkspaces: true }],
    ['hide CLI-created', { hideCliCreatedWorkspaces: true }],
    ['hide other devices', { hideWorkspacesFromOtherDevices: true }],
    ['Projects filter', { filterRepoIds: ['notes'] }]
  ]

  for (const [name, filter] of filters) {
    it(`keeps every git root through "${name}"`, () => {
      expect(keptRoots(visibleIds(filter))).not.toEqual(GIT_ROOTS)
      expect(keptRoots(visibleIds({ ...filter, keepServerRoots: true }))).toEqual(GIT_ROOTS)
    })
  }

  it('still filters every other workspace, the folder project root included', () => {
    const ids = visibleIds({ filterRepoIds: ['api'], keepServerRoots: true })

    expect(ids).not.toContain('web-feature')
    expect(ids).not.toContain('notes-root')
  })

  it('keeps the sort order of the list', () => {
    // Why no notes-root: a folder project's root is its default workspace, and it has no server.
    expect(visibleIds({ hideDefaultBranchWorkspace: true, keepServerRoots: true })).toEqual([
      'web-feature',
      'web-root',
      'api-root',
      'remote-root',
      'home-root'
    ])
  })

  it('respects the active space', () => {
    const work: SidebarSpaceScope = {
      groupIds: new Set(['work']),
      repoIds: new Set(['web', 'api', 'notes']),
      folderWorkspaceIds: new Set()
    }

    expect(
      visibleIds({ spaceScope: work, hideDefaultBranchWorkspace: true, keepServerRoots: true })
    ).toEqual(['web-feature', 'web-root', 'api-root'])
  })

  it('respects the host scope', () => {
    expect(
      visibleIds({
        workspaceHostScope: 'ssh:box',
        hideDefaultBranchWorkspace: true,
        keepServerRoots: true
      })
    ).toEqual(['remote-root'])
  })

  it('never brings back an archived root', () => {
    const ids = visibleIds(
      { hideDefaultBranchWorkspace: true, keepServerRoots: true },
      { ...worktreesByRepo, api: [{ ...apiRoot, isArchived: true }] }
    )

    expect(ids).not.toContain('api-root')
  })

  it('changes nothing without the option, as in every other Group by', () => {
    expect(visibleIds({ hideDefaultBranchWorkspace: true })).toEqual(['web-feature', 'remote-root'])
  })
})
