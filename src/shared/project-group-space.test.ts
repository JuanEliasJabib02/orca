import { describe, expect, it } from 'vitest'
import type { FolderWorkspace } from './folder-workspaces/folder-workspace-types'
import type { ProjectGroup } from './project-group-types'
import type { Repo } from './repo-types'
import { findTopLevelGroupId, findWorktreeSidebarSpaceId, laneKeyOf } from './project-group-space'

type Group = Pick<ProjectGroup, 'id' | 'parentGroupId'>

const groups: Group[] = [
  { id: 'ag', parentGroupId: null },
  { id: 'ag-clients', parentGroupId: 'ag' },
  { id: 'ag-clients-legacy', parentGroupId: 'ag-clients' },
  { id: 'action', parentGroupId: null },
  // Why: its parent was deleted, so the chain never reaches a space.
  { id: 'orphan', parentGroupId: 'deleted-group' }
]

const repos: Pick<Repo, 'id' | 'projectGroupId'>[] = [
  { id: 'shop', projectGroupId: 'ag-clients-legacy' },
  { id: 'back', projectGroupId: 'action' },
  { id: 'expenses', projectGroupId: null },
  { id: 'old', projectGroupId: 'deleted-group' },
  { id: 'lost', projectGroupId: 'orphan' }
]

const folderWorkspaces: Pick<FolderWorkspace, 'id' | 'projectGroupId'>[] = [
  { id: 'notes', projectGroupId: 'ag-clients' }
]

const sources = { projectGroups: groups, repos, folderWorkspaces }

describe('findTopLevelGroupId', () => {
  it('walks a nested group up to its space', () => {
    expect(findTopLevelGroupId('ag-clients-legacy', groups)).toBe('ag')
    expect(findTopLevelGroupId('action', groups)).toBe('action')
  })

  it('is null for an unknown group, a broken chain or a cycle', () => {
    expect(findTopLevelGroupId('deleted-group', groups)).toBeNull()
    expect(findTopLevelGroupId('orphan', groups)).toBeNull()
    expect(
      findTopLevelGroupId('a', [
        { id: 'a', parentGroupId: 'b' },
        { id: 'b', parentGroupId: 'a' }
      ])
    ).toBeNull()
  })
})

describe('findWorktreeSidebarSpaceId', () => {
  it('names the space of a repo worktree and of a folder workspace', () => {
    expect(findWorktreeSidebarSpaceId({ id: 'shop::/wt/ag-1', repoId: 'shop' }, sources)).toBe('ag')
    expect(
      findWorktreeSidebarSpaceId(
        { id: 'folder:notes', repoId: 'folder-workspace:ag-clients' },
        sources
      )
    ).toBe('ag')
  })
})

describe('laneKeyOf', () => {
  it('puts a worktree in the lane of its top-level group, however deep its group is', () => {
    expect(laneKeyOf('shop::/wt/ag-1', sources)).toBe('ag')
    expect(laneKeyOf('back::/wt/ax-1', sources)).toBe('action')
  })

  it('puts every spaceless repo in one shared lane', () => {
    expect(laneKeyOf('expenses::/wt/fix', sources)).toBe('spaceless')
    expect(laneKeyOf('old::/wt/fix', sources)).toBe('spaceless')
    expect(laneKeyOf('lost::/wt/fix', sources)).toBe('spaceless')
    expect(laneKeyOf('unknown-repo::/wt/fix', sources)).toBe('spaceless')
  })

  it('reads a folder workspace from its key or from its synthetic project id', () => {
    expect(laneKeyOf('folder:notes', sources)).toBe('ag')
    expect(laneKeyOf('folder-workspace:ag-clients::/notes', sources)).toBe('ag')
    expect(laneKeyOf('folder:missing', sources)).toBe('spaceless')
  })
})
