import { describe, expect, it } from 'vitest'
import type { LiveAgentWorktreeStatus } from '@/lib/worktree-activity-state'
import {
  rollUpSidebarSpaceAttention,
  type SidebarSpaceAttentionSources
} from './sidebar-space-attention'

type Sources = SidebarSpaceAttentionSources

function group(id: string, parentGroupId: string | null = null): Sources['projectGroups'][number] {
  return { id, parentGroupId }
}

function repo(id: string, projectGroupId: string | null = null): Sources['repos'][number] {
  return { id, projectGroupId }
}

function worktree(
  id: string,
  repoId: string,
  overrides: { isUnread?: boolean; isArchived?: boolean } = {}
): Sources['worktreesByRepo'][string][number] {
  return { id, repoId, isUnread: false, isArchived: false, ...overrides }
}

function folderWorkspace(
  id: string,
  projectGroupId: string,
  overrides: { isUnread?: boolean; isArchived?: boolean } = {}
): Sources['folderWorkspaces'][number] {
  return { id, projectGroupId, isUnread: false, isArchived: false, ...overrides }
}

function rollUp(overrides: Partial<Sources> = {}) {
  return rollUpSidebarSpaceAttention({
    projectGroups: [],
    repos: [],
    folderWorkspaces: [],
    worktreesByRepo: {},
    tabsByWorktree: {},
    unreadTerminalTabs: {},
    liveAgentStatusByWorktreeId: new Map<string, LiveAgentWorktreeStatus>(),
    ...overrides
  })
}

function spaceEntries(rollup: ReturnType<typeof rollUp>): [string, string][] {
  return [...rollup.entries()]
}

describe('rollUpSidebarSpaceAttention', () => {
  it('reports nothing when no workspace needs attention', () => {
    const rollup = rollUp({
      projectGroups: [group('work')],
      repos: [repo('r1', 'work')],
      worktreesByRepo: { r1: [worktree('r1::a', 'r1')] },
      liveAgentStatusByWorktreeId: new Map([['r1::a', 'working']])
    })

    expect(spaceEntries(rollup)).toEqual([])
  })

  it('flags a space when one of its repo worktrees is unread', () => {
    const rollup = rollUp({
      projectGroups: [group('work'), group('personal')],
      repos: [repo('r1', 'work'), repo('r2', 'personal')],
      worktreesByRepo: {
        r1: [worktree('r1::a', 'r1', { isUnread: true })],
        r2: [worktree('r2::a', 'r2')]
      }
    })

    expect(spaceEntries(rollup)).toEqual([['work', 'unread']])
  })

  it('flags a space when a live agent in one of its worktrees is waiting on the user', () => {
    const rollup = rollUp({
      projectGroups: [group('work')],
      repos: [repo('r1', 'work')],
      worktreesByRepo: { r1: [worktree('r1::a', 'r1')] },
      liveAgentStatusByWorktreeId: new Map([['r1::a', 'permission']])
    })

    expect(spaceEntries(rollup)).toEqual([['work', 'permission']])
  })

  it('does not treat a working or monitoring agent as needing attention', () => {
    const rollup = rollUp({
      projectGroups: [group('work')],
      repos: [repo('r1', 'work')],
      worktreesByRepo: { r1: [worktree('r1::a', 'r1'), worktree('r1::b', 'r1')] },
      liveAgentStatusByWorktreeId: new Map<string, LiveAgentWorktreeStatus>([
        ['r1::a', 'working'],
        ['r1::b', 'monitoring']
      ])
    })

    expect(spaceEntries(rollup)).toEqual([])
  })

  it('lets permission beat unread in the same space, on another worktree or the same one', () => {
    const projectGroups = [group('work')]
    const repos = [repo('r1', 'work')]
    const worktreesByRepo = {
      r1: [worktree('r1::a', 'r1', { isUnread: true }), worktree('r1::b', 'r1')]
    }

    const permissionLast = rollUp({
      projectGroups,
      repos,
      worktreesByRepo,
      liveAgentStatusByWorktreeId: new Map([['r1::b', 'permission']])
    })
    const permissionOnSameWorktree = rollUp({
      projectGroups,
      repos,
      worktreesByRepo,
      liveAgentStatusByWorktreeId: new Map([['r1::a', 'permission']])
    })

    expect(spaceEntries(permissionLast)).toEqual([['work', 'permission']])
    expect(spaceEntries(permissionOnSameWorktree)).toEqual([['work', 'permission']])
  })

  it('does not downgrade a space from permission to unread', () => {
    const rollup = rollUp({
      projectGroups: [group('work')],
      repos: [repo('r1', 'work')],
      worktreesByRepo: { r1: [worktree('r1::a', 'r1'), worktree('r1::b', 'r1')] },
      tabsByWorktree: { 'r1::b': [{ id: 'tab-b' }] },
      unreadTerminalTabs: { 'tab-b': true },
      liveAgentStatusByWorktreeId: new Map([['r1::a', 'permission']])
    })

    expect(spaceEntries(rollup)).toEqual([['work', 'permission']])
  })

  it('flags unread from a terminal tab even when the worktree is not marked unread', () => {
    const rollup = rollUp({
      projectGroups: [group('work'), group('personal')],
      repos: [repo('r1', 'work'), repo('r2', 'personal')],
      worktreesByRepo: { r1: [worktree('r1::a', 'r1')], r2: [worktree('r2::a', 'r2')] },
      tabsByWorktree: {
        'r1::a': [{ id: 'tab-1' }, { id: 'tab-2' }],
        'r2::a': [{ id: 'tab-3' }]
      },
      unreadTerminalTabs: { 'tab-2': true }
    })

    expect(spaceEntries(rollup)).toEqual([['work', 'unread']])
  })

  it('ignores an unread tab that no workspace owns', () => {
    const rollup = rollUp({
      projectGroups: [group('work')],
      repos: [repo('r1', 'work')],
      worktreesByRepo: { r1: [worktree('r1::a', 'r1')] },
      tabsByWorktree: { 'r1::a': [{ id: 'tab-1' }] },
      unreadTerminalTabs: { 'ghost-tab': true }
    })

    expect(spaceEntries(rollup)).toEqual([])
  })

  it('attributes a folder workspace to its group for unread, unread tabs and permission', () => {
    const projectGroups = [group('work'), group('personal'), group('side')]
    const folderWorkspaces = [
      folderWorkspace('f1', 'work', { isUnread: true }),
      folderWorkspace('f2', 'personal'),
      folderWorkspace('f3', 'side')
    ]
    const rollup = rollUp({
      projectGroups,
      folderWorkspaces,
      tabsByWorktree: { 'folder:f2': [{ id: 'folder-tab' }] },
      unreadTerminalTabs: { 'folder-tab': true },
      liveAgentStatusByWorktreeId: new Map([['folder:f3', 'permission']])
    })

    expect(Object.fromEntries(rollup)).toEqual({
      work: 'unread',
      personal: 'unread',
      side: 'permission'
    })
  })

  it('rolls a nested group up to its top-level space', () => {
    const rollup = rollUp({
      projectGroups: [group('work'), group('clients', 'work'), group('acme', 'clients')],
      repos: [repo('r1', 'acme')],
      folderWorkspaces: [folderWorkspace('f1', 'clients', { isUnread: true })],
      worktreesByRepo: { r1: [worktree('r1::a', 'r1')] },
      liveAgentStatusByWorktreeId: new Map([['r1::a', 'permission']])
    })

    expect(Object.fromEntries(rollup)).toEqual({ work: 'permission' })
  })

  it('ignores projects outside every group, since no space contains them', () => {
    const rollup = rollUp({
      projectGroups: [group('work')],
      repos: [repo('r1', 'work'), repo('loose'), repo('nullGroup', null)],
      worktreesByRepo: {
        r1: [worktree('r1::a', 'r1')],
        loose: [worktree('loose::a', 'loose', { isUnread: true })],
        nullGroup: [worktree('nullGroup::a', 'nullGroup')]
      },
      tabsByWorktree: { 'nullGroup::a': [{ id: 'loose-tab' }] },
      unreadTerminalTabs: { 'loose-tab': true },
      liveAgentStatusByWorktreeId: new Map([['nullGroup::a', 'permission']])
    })

    expect(spaceEntries(rollup)).toEqual([])
  })

  it('ignores a repo missing from the repo list', () => {
    const rollup = rollUp({
      projectGroups: [group('work')],
      worktreesByRepo: { orphan: [worktree('orphan::a', 'orphan', { isUnread: true })] }
    })

    expect(spaceEntries(rollup)).toEqual([])
  })

  it('ignores a repo pointing at a deleted group', () => {
    const rollup = rollUp({
      projectGroups: [group('work')],
      repos: [repo('r1', 'deleted-group')],
      worktreesByRepo: { r1: [worktree('r1::a', 'r1', { isUnread: true })] }
    })

    expect(spaceEntries(rollup)).toEqual([])
  })

  it('ignores a group under a missing parent, since no space contains it', () => {
    const rollup = rollUp({
      projectGroups: [group('work'), group('orphaned', 'deleted-parent')],
      repos: [repo('r1', 'orphaned')],
      folderWorkspaces: [folderWorkspace('f1', 'orphaned', { isUnread: true })],
      worktreesByRepo: { r1: [worktree('r1::a', 'r1', { isUnread: true })] }
    })

    expect(spaceEntries(rollup)).toEqual([])
  })

  it('terminates on a parent cycle and ignores the groups on it', () => {
    const rollup = rollUp({
      projectGroups: [group('work'), group('a', 'b'), group('b', 'a'), group('self', 'self')],
      repos: [repo('r1', 'a'), repo('r2', 'self')],
      worktreesByRepo: {
        r1: [worktree('r1::a', 'r1', { isUnread: true })],
        r2: [worktree('r2::a', 'r2')]
      },
      liveAgentStatusByWorktreeId: new Map([['r2::a', 'permission']])
    })

    expect(spaceEntries(rollup)).toEqual([])
  })

  it('ignores archived worktrees and folder workspaces for every signal', () => {
    const rollup = rollUp({
      projectGroups: [group('work')],
      repos: [repo('r1', 'work')],
      folderWorkspaces: [folderWorkspace('f1', 'work', { isUnread: true, isArchived: true })],
      worktreesByRepo: {
        r1: [
          worktree('r1::unread', 'r1', { isUnread: true, isArchived: true }),
          worktree('r1::waiting', 'r1', { isArchived: true }),
          worktree('r1::tab', 'r1', { isArchived: true })
        ]
      },
      tabsByWorktree: { 'r1::tab': [{ id: 'tab-1' }], 'folder:f1': [{ id: 'tab-2' }] },
      unreadTerminalTabs: { 'tab-1': true, 'tab-2': true },
      liveAgentStatusByWorktreeId: new Map<string, LiveAgentWorktreeStatus>([
        ['r1::waiting', 'permission'],
        ['folder:f1', 'permission']
      ])
    })

    expect(spaceEntries(rollup)).toEqual([])
  })

  it('keeps an archived sibling from hiding a live one', () => {
    const rollup = rollUp({
      projectGroups: [group('work')],
      repos: [repo('r1', 'work')],
      worktreesByRepo: {
        r1: [worktree('r1::old', 'r1', { isArchived: true }), worktree('r1::live', 'r1')]
      },
      liveAgentStatusByWorktreeId: new Map([['r1::live', 'permission']])
    })

    expect(spaceEntries(rollup)).toEqual([['work', 'permission']])
  })

  it('ignores a live agent whose worktree is unknown', () => {
    const rollup = rollUp({
      projectGroups: [group('work')],
      repos: [repo('r1', 'work')],
      worktreesByRepo: { r1: [worktree('r1::a', 'r1')] },
      liveAgentStatusByWorktreeId: new Map([['elsewhere::x', 'permission']])
    })

    expect(spaceEntries(rollup)).toEqual([])
  })

  it('keeps spaces independent of each other', () => {
    const rollup = rollUp({
      projectGroups: [group('work'), group('personal'), group('side')],
      repos: [repo('r1', 'work'), repo('r2', 'personal'), repo('r3', 'side')],
      worktreesByRepo: {
        r1: [worktree('r1::a', 'r1', { isUnread: true })],
        r2: [worktree('r2::a', 'r2')],
        r3: [worktree('r3::a', 'r3')]
      },
      liveAgentStatusByWorktreeId: new Map([['r2::a', 'permission']])
    })

    expect(Object.fromEntries(rollup)).toEqual({ work: 'unread', personal: 'permission' })
    expect(rollup.has('side')).toBe(false)
  })
})
