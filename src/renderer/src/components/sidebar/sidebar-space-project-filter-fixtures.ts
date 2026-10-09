import type { ProjectGroup } from '../../../../shared/project-group-types'
import type { Repo } from '../../../../shared/repo-types'

// Store fixtures for the Projects filter suites: two spaces, two projects in "work", one in "personal".

function makeSpaceGroup(id: string, tabOrder: number): ProjectGroup {
  return {
    id,
    name: id,
    parentPath: null,
    parentGroupId: null,
    createdFrom: 'manual',
    tabOrder,
    isCollapsed: false,
    color: null,
    createdAt: 0,
    updatedAt: 0
  }
}

function makeSpaceRepo(id: string, projectGroupId: string): Repo {
  return {
    id,
    path: `/tmp/${id}`,
    displayName: id,
    badgeColor: '#000000',
    addedAt: 0,
    projectGroupId
  }
}

export const SPACE_FILTER_REPOS: Repo[] = [
  makeSpaceRepo('work-api', 'work'),
  makeSpaceRepo('work-web', 'work'),
  makeSpaceRepo('personal-blog', 'personal')
]

/** Store fields the Projects filters read to resolve the active space. */
export function spaceFilterStoreState(activeSidebarSpaceGroupId: string | null) {
  return {
    repos: SPACE_FILTER_REPOS,
    projectGroups: [makeSpaceGroup('work', 0), makeSpaceGroup('personal', 1)],
    folderWorkspaces: [],
    activeSidebarSpaceGroupId
  }
}
