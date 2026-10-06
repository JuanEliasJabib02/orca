import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { folderWorkspaceRepoId } from '../../../../shared/folder-workspace-worktree'
import {
  getWorktreeCardProjectLabel,
  WorktreeCardProjectLabel
} from './worktree-card-project-label'

const NON_REPO_GROUPINGS = ['none', 'workspace-status', 'pr-status', 'task'] as const
const PROJECT_GROUPS = [
  { id: 'group-1', name: 'Client apps' },
  { id: 'group-2', name: '  ' }
]

function label(overrides: Partial<Parameters<typeof getWorktreeCardProjectLabel>[0]> = {}) {
  return getWorktreeCardProjectLabel({
    groupBy: 'none',
    affiliateListMode: false,
    repo: { displayName: 'orca' },
    worktreeRepoId: 'repo-1',
    projectGroups: PROJECT_GROUPS,
    ...overrides
  })
}

describe('getWorktreeCardProjectLabel', () => {
  it.each(NON_REPO_GROUPINGS)('names the repo when grouped by %s', (groupBy) => {
    expect(label({ groupBy })).toBe('orca')
  })

  it('stays hidden under Project grouping, where the section header names the project', () => {
    expect(label({ groupBy: 'repo' })).toBeNull()
  })

  it('stays hidden in the right-sidebar affiliate list', () => {
    expect(label({ affiliateListMode: true })).toBeNull()
  })

  it.each(NON_REPO_GROUPINGS)(
    'names the project group of a folder workspace under %s',
    (groupBy) => {
      expect(
        label({ groupBy, repo: undefined, worktreeRepoId: folderWorkspaceRepoId('group-1') })
      ).toBe('Client apps')
    }
  )

  it('omits the label when the folder workspace has no resolvable project group', () => {
    expect(
      label({ repo: undefined, worktreeRepoId: folderWorkspaceRepoId('group-missing') })
    ).toBeNull()
    expect(label({ repo: undefined, worktreeRepoId: folderWorkspaceRepoId('group-2') })).toBeNull()
  })

  it('omits the label for a worktree whose repo has not loaded yet', () => {
    expect(label({ repo: undefined, worktreeRepoId: 'repo-1' })).toBeNull()
  })

  it('omits a blank repo name', () => {
    expect(label({ repo: { displayName: '   ' } })).toBeNull()
  })
})

describe('WorktreeCardProjectLabel', () => {
  it('renders one muted 11px line that truncates', () => {
    const markup = renderToStaticMarkup(
      <WorktreeCardProjectLabel label="orca" tooltipEnabled={false} className="-mt-1" />
    )

    expect(markup).toContain('data-worktree-card-project-label=""')
    expect(markup).toContain('text-[11px]')
    expect(markup).toContain('text-muted-foreground')
    expect(markup).toContain('truncate')
    expect(markup).toContain('>orca<')
    expect(markup).toContain('-mt-1')
  })
})
