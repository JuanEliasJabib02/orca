import type { ProjectGroup } from '../../../../shared/project-group-types'
import type { Repo } from '../../../../shared/repo-types'
import type { ProjectOrderBy } from '../../../../shared/ui-chrome-types'
import type { WorkspaceStatus, Worktree } from '../../../../shared/worktree/types'
import { projectGroupIdFromRepoId } from '../../../../shared/folder-workspace-worktree'
import { getProjectGroupHeaderKey } from './worktree-list/grouping/group-keys'
import {
  addRepoIdToGroup,
  getProjectGroupingForRepo,
  type ProjectGroupingIndex,
  type WorktreeGroupEntry
} from './worktree-list/grouping/project-grouping'
import {
  sortProjectEntries,
  withRepoSectionDisplayLabels
} from './worktree-list/grouping/section-order'
import {
  getLaneItemWorktrees,
  isLaneCardItem,
  type WorkspaceKanbanCardLaneItem,
  type WorkspaceKanbanLaneItem,
  type WorkspaceKanbanProjectHeaderLaneItem
} from './workspace-kanban-lane-items'

/** What Group by → Project needs to file the board's cards; the sidebar's project inputs. */
export type WorkspaceKanbanProjectSections = {
  repoMap: Map<string, Repo>
  projectIndex: ProjectGroupingIndex | null
  projectGroups: readonly ProjectGroup[]
  projectOrderBy: ProjectOrderBy
  /** Manual project order: each repo id's rank in the store's repo list. */
  repoOrder: Map<string, number> | undefined
}

type ProjectSection = { key: string; label: string; repo?: Repo; repoId?: string }

// Why the anchor: a task card spans repos, so it files under its first member's project.
function getCardAnchorWorktree(item: WorkspaceKanbanCardLaneItem): Worktree | undefined {
  return item.type === 'worktree' ? item.worktree : item.worktrees[0]
}

/** The sidebar's section for a card: its repo's project, or a folder workspace's own group. */
function getProjectSection(
  worktree: Worktree,
  sections: WorkspaceKanbanProjectSections,
  groupById: ReadonlyMap<string, ProjectGroup>
): ProjectSection {
  const groupId = projectGroupIdFromRepoId(worktree.repoId)
  const group = groupId ? groupById.get(groupId) : undefined
  if (group) {
    return { key: getProjectGroupHeaderKey(group.id), label: group.name }
  }
  const grouping = getProjectGroupingForRepo(
    worktree.repoId,
    sections.repoMap,
    sections.projectIndex
  )
  return { key: grouping.key, label: grouping.label, repo: grouping.repo, repoId: worktree.repoId }
}

/**
 * Files each lane's cards under project sub-headers. Headers follow one board-wide order (the
 * sidebar's project order), each section keeps the lane's own sort, and a project with no card
 * in a lane gets no header there.
 */
export function sectionWorkspaceKanbanLaneItemsByProject(
  laneItems: ReadonlyMap<WorkspaceStatus, readonly WorkspaceKanbanLaneItem[]>,
  sections: WorkspaceKanbanProjectSections
): Map<WorkspaceStatus, WorkspaceKanbanLaneItem[]> {
  const groupById = new Map(sections.projectGroups.map((group) => [group.id, group]))
  const sectionByCard = new Map<WorkspaceKanbanCardLaneItem, ProjectSection>()
  const entries = new Map<string, WorktreeGroupEntry>()
  for (const items of laneItems.values()) {
    for (const item of items) {
      if (!isLaneCardItem(item)) {
        continue
      }
      const anchor = getCardAnchorWorktree(item)
      if (!anchor) {
        continue
      }
      const section = getProjectSection(anchor, sections, groupById)
      sectionByCard.set(item, section)
      let entry = entries.get(section.key)
      if (!entry) {
        entry = { label: section.label, items: [], repo: section.repo, repoIds: new Set() }
        entries.set(section.key, entry)
      }
      for (const worktree of getLaneItemWorktrees(item)) {
        entry.items.push(worktree)
      }
      if (section.repoId) {
        addRepoIdToGroup(entry, section.repoId)
      }
    }
  }

  // Why one board-wide order: a project keeps its place across lanes.
  const ordered = withRepoSectionDisplayLabels(
    sortProjectEntries([...entries], sections.projectOrderBy, sections.repoOrder)
  )
  const rankByKey = new Map(ordered.map(([key], index) => [key, index]))
  const entryByKey = new Map(ordered)

  const sectioned = new Map<WorkspaceStatus, WorkspaceKanbanLaneItem[]>()
  for (const [status, items] of laneItems) {
    const lane: WorkspaceKanbanLaneItem[] = []
    const cardsByKey = new Map<string, WorkspaceKanbanCardLaneItem[]>()
    for (const item of items) {
      // Why: headers already in the input are rebuilt below, never kept.
      if (!isLaneCardItem(item)) {
        continue
      }
      const section = sectionByCard.get(item)
      if (!section) {
        // Why: a card with no worktree to file stays, headerless, at the top rather than vanish.
        lane.push(item)
        continue
      }
      const cards = cardsByKey.get(section.key)
      if (cards) {
        cards.push(item)
      } else {
        cardsByKey.set(section.key, [item])
      }
    }
    const keys = [...cardsByKey.keys()].sort(
      (left, right) => (rankByKey.get(left) ?? 0) - (rankByKey.get(right) ?? 0)
    )
    for (const key of keys) {
      const cards = cardsByKey.get(key) ?? []
      const entry = entryByKey.get(key)
      const header: WorkspaceKanbanProjectHeaderLaneItem = {
        type: 'project-header',
        key: `project-header:${status}:${key}`,
        projectKey: key,
        label: entry?.label ?? key,
        repo: entry?.repo,
        count: cards.length
      }
      lane.push(header)
      for (const card of cards) {
        lane.push(card)
      }
    }
    sectioned.set(status, lane)
  }
  return sectioned
}
