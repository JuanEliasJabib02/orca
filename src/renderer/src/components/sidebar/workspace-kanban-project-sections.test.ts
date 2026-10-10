import { describe, expect, it } from 'vitest'
import type { ProjectGroup } from '../../../../shared/project-group-types'
import type { Project, ProjectHostSetup } from '../../../../shared/project-types'
import type { Repo } from '../../../../shared/repo-types'
import type { Worktree } from '../../../../shared/worktree/types'
import { makeWorktree } from '../../store/slices/store-test-helpers'
import { makeRepo } from '../worktree-jump-palette-test-fixtures'
import { buildProjectGroupingIndex } from './worktree-list/grouping/project-grouping'
import {
  getLaneItemWorktreeIds,
  toWorkspaceKanbanWorktreeLaneItems,
  type WorkspaceKanbanLaneItem
} from './workspace-kanban-lane-items'
import {
  sectionWorkspaceKanbanLaneItemsByProject,
  type WorkspaceKanbanProjectSections
} from './workspace-kanban-project-sections'

function repo(id: string, displayName: string, addedAt = 0): Repo {
  return { ...makeRepo(), id, path: `/repos/${id}`, displayName, addedAt }
}

function worktree(repoId: string, name: string, lastActivityAt = 0): Worktree {
  return makeWorktree({ id: `${repoId}::/${name}`, repoId, hostId: 'local', lastActivityAt })
}

const api = repo('api', 'api')
const web = repo('web', 'web')
const docs = repo('docs', 'docs')
const repoMap = new Map([api, web, docs].map((entry) => [entry.id, entry]))

function sections(
  overrides: Partial<WorkspaceKanbanProjectSections> = {}
): WorkspaceKanbanProjectSections {
  return {
    repoMap,
    projectIndex: null,
    projectGroups: [],
    projectOrderBy: 'manual',
    // Manual project order: web, api, docs.
    repoOrder: new Map([
      ['web', 0],
      ['api', 1],
      ['docs', 2]
    ]),
    ...overrides
  }
}

function lanes(byStatus: Record<string, Worktree[]>): Map<string, WorkspaceKanbanLaneItem[]> {
  return new Map(
    Object.entries(byStatus).map(([status, worktrees]) => [
      status,
      toWorkspaceKanbanWorktreeLaneItems(worktrees)
    ])
  )
}

function describeLane(items: readonly WorkspaceKanbanLaneItem[] | undefined): string[] {
  return (items ?? []).map((item) => {
    if (item.type === 'project-header') {
      return `# ${item.label} (${item.count})`
    }
    return getLaneItemWorktreeIds([item]).join(', ')
  })
}

describe('sectionWorkspaceKanbanLaneItemsByProject', () => {
  const apiOne = worktree('api', 'one')
  const webOne = worktree('web', 'one')
  const apiTwo = worktree('api', 'two')
  const docsOne = worktree('docs', 'one')

  it('files each lane under project headers in the manual project order', () => {
    const sectioned = sectionWorkspaceKanbanLaneItemsByProject(
      lanes({ todo: [apiOne, webOne, apiTwo], done: [docsOne] }),
      sections()
    )

    expect(describeLane(sectioned.get('todo'))).toEqual([
      '# web (1)',
      webOne.id,
      '# api (2)',
      apiOne.id,
      apiTwo.id
    ])
    expect(describeLane(sectioned.get('done'))).toEqual(['# docs (1)', docsOne.id])
  })

  it('keeps the lane sort inside a project and skips projects with no card in the lane', () => {
    const sectioned = sectionWorkspaceKanbanLaneItemsByProject(
      lanes({ todo: [apiTwo, apiOne], 'in-progress': [] }),
      sections()
    )

    expect(describeLane(sectioned.get('todo'))).toEqual(['# api (2)', apiTwo.id, apiOne.id])
    expect(describeLane(sectioned.get('in-progress'))).toEqual([])
  })

  it('gives every header of one project the same project key and a lane-unique key', () => {
    const sectioned = sectionWorkspaceKanbanLaneItemsByProject(
      lanes({ todo: [apiOne], done: [apiTwo] }),
      sections()
    )
    const headers = [...sectioned.values()].flatMap((items) =>
      items.flatMap((item) => (item.type === 'project-header' ? [item] : []))
    )

    expect(headers.map((header) => header.projectKey)).toEqual(['repo:api', 'repo:api'])
    expect(new Set(headers.map((header) => header.key)).size).toBe(2)
  })

  it('orders projects by latest activity under Recent', () => {
    const sectioned = sectionWorkspaceKanbanLaneItemsByProject(
      lanes({ todo: [worktree('web', 'old', 10), worktree('docs', 'new', 50)] }),
      sections({ projectOrderBy: 'recent' })
    )

    expect(describeLane(sectioned.get('todo')).filter((row) => row.startsWith('#'))).toEqual([
      '# docs (1)',
      '# web (1)'
    ])
  })

  it('merges the repos of one project under a single header', () => {
    const remote = repo('api-ssh', 'api (box)')
    const project: Project = {
      id: 'orca',
      displayName: 'Orca',
      badgeColor: '#000000',
      sourceRepoIds: ['api', 'api-ssh'],
      createdAt: 0,
      updatedAt: 0
    }
    const setup = (repoId: string, hostId: ProjectHostSetup['hostId']): ProjectHostSetup => ({
      id: `setup-${repoId}`,
      projectId: 'orca',
      hostId,
      repoId,
      path: `/repos/${repoId}`,
      displayName: repoId,
      setupState: 'ready',
      setupMethod: 'cloned',
      createdAt: 0,
      updatedAt: 0
    })
    const remoteOne = worktree('api-ssh', 'one')

    const sectioned = sectionWorkspaceKanbanLaneItemsByProject(
      lanes({ todo: [apiOne, remoteOne] }),
      sections({
        repoMap: new Map([...repoMap, [remote.id, remote]]),
        projectIndex: buildProjectGroupingIndex({
          projects: [project],
          projectHostSetups: [setup('api', 'local'), setup('api-ssh', 'ssh:box')]
        })
      })
    )

    expect(describeLane(sectioned.get('todo'))).toEqual(['# Orca (2)', apiOne.id, remoteOne.id])
  })

  it('files a folder workspace under its own project group', () => {
    const group: ProjectGroup = {
      id: 'notes-group',
      name: 'Notes',
      parentPath: null,
      parentGroupId: null,
      createdFrom: 'manual',
      tabOrder: 0,
      isCollapsed: false,
      color: null,
      createdAt: 0,
      updatedAt: 0
    }
    const folder = makeWorktree({
      id: 'folder:journal',
      repoId: 'folder-workspace:notes-group',
      branch: '',
      hostId: 'local'
    })

    const sectioned = sectionWorkspaceKanbanLaneItemsByProject(
      lanes({ todo: [folder, apiOne] }),
      sections({ projectGroups: [group] })
    )

    expect(describeLane(sectioned.get('todo'))).toEqual([
      '# api (1)',
      apiOne.id,
      '# Notes (1)',
      folder.id
    ])
    const header = sectioned.get('todo')?.find((item) => item.type === 'project-header')
    expect(header?.type === 'project-header' && header.repo).toBe(api)
  })

  it('rebuilds instead of stacking headers when given an already sectioned lane', () => {
    const once = sectionWorkspaceKanbanLaneItemsByProject(
      lanes({ todo: [apiOne, webOne] }),
      sections()
    )
    const twice = sectionWorkspaceKanbanLaneItemsByProject(once, sections())

    expect(describeLane(twice.get('todo'))).toEqual(describeLane(once.get('todo')))
  })
})
