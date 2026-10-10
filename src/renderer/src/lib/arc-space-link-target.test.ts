import { describe, expect, it } from 'vitest'
import { FLOATING_TERMINAL_WORKTREE_ID } from '../../../shared/constants'
import type { ProjectGroup } from '../../../shared/project-group-types'
import { resolveArcSpaceForWorktree, type ArcSpaceLinkSources } from './arc-space-link-target'

function group(id: string, tabOrder: number, parentGroupId: string | null = null): ProjectGroup {
  return {
    id,
    name: id,
    parentPath: null,
    parentGroupId,
    createdFrom: 'manual',
    tabOrder,
    isCollapsed: false,
    color: null,
    createdAt: 0,
    updatedAt: 0
  }
}

function sources(overrides: Partial<ArcSpaceLinkSources> = {}): ArcSpaceLinkSources {
  return {
    settings: {
      openLinksInArcSpaces: true,
      arcSpaceNameBySidebarSpaceId: { action: 'Action', personal: 'Personal', ag: 'Bulbasour' }
    },
    projectGroups: [
      group('action', 0),
      group('personal', 1),
      group('ag', 2),
      group('ag-sub', 0, 'ag')
    ],
    repos: [
      { id: 'r-action', projectGroupId: 'action' },
      { id: 'r-ag', projectGroupId: 'ag-sub' },
      { id: 'r-loose', projectGroupId: null }
    ],
    folderWorkspaces: [{ id: 'fw-1', projectGroupId: 'personal' }],
    activeSidebarSpaceGroupId: 'ag',
    ...overrides
  }
}

describe('resolveArcSpaceForWorktree', () => {
  it('returns nothing while the opt-in is off', () => {
    const off = sources({
      settings: { openLinksInArcSpaces: false, arcSpaceNameBySidebarSpaceId: { action: 'Action' } }
    })
    expect(resolveArcSpaceForWorktree('r-action::/repo', off)).toBeUndefined()
    expect(resolveArcSpaceForWorktree('r-action::/repo', null)).toBeUndefined()
  })

  it("uses the Arc space mapped to the worktree's space", () => {
    expect(resolveArcSpaceForWorktree('r-action::/repo', sources())).toBe('Action')
  })

  it('resolves a project in a nested group to its top-level space', () => {
    expect(resolveArcSpaceForWorktree('r-ag::/repo/wt', sources())).toBe('Bulbasour')
  })

  it('resolves a folder workspace through its group', () => {
    expect(resolveArcSpaceForWorktree('folder:fw-1', sources())).toBe('Personal')
  })

  it('falls back to the active space for links outside any space', () => {
    expect(resolveArcSpaceForWorktree(FLOATING_TERMINAL_WORKTREE_ID, sources())).toBe('Bulbasour')
    expect(resolveArcSpaceForWorktree('r-loose::/repo', sources())).toBe('Bulbasour')
    expect(resolveArcSpaceForWorktree(null, sources())).toBe('Bulbasour')
    expect(resolveArcSpaceForWorktree(null, sources({ activeSidebarSpaceGroupId: null }))).toBe(
      'Action'
    )
  })

  it('opens normally when the space has no Arc name', () => {
    const blank = sources({
      settings: { openLinksInArcSpaces: true, arcSpaceNameBySidebarSpaceId: { action: '  ' } }
    })
    expect(resolveArcSpaceForWorktree('r-action::/repo', blank)).toBeUndefined()
    expect(resolveArcSpaceForWorktree('r-ag::/repo/wt', blank)).toBeUndefined()
  })
})
