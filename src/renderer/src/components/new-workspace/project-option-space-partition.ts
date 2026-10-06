import type { NewWorkspaceProjectOption } from '@/lib/new-workspace-project-options'
import type { SidebarSpaceScope } from '@/components/sidebar/sidebar-space-scope'
import { translate } from '@/i18n/i18n'
import {
  sectionProjectOptions,
  type ProjectOptionSection,
  type ScoredProjectOption
} from './project-combobox-matching'

type SpaceMembership = Pick<SidebarSpaceScope, 'groupIds' | 'repoIds'>

function isProjectInSpace(
  repoIds: readonly string[] | undefined,
  spaceRepoIds: ReadonlySet<string>
): boolean {
  // Why fail open: a project whose repos are unknown must stay listed, not vanish behind a search.
  return !repoIds || repoIds.length === 0 || repoIds.some((repoId) => spaceRepoIds.has(repoId))
}

/**
 * Option ids that belong to a space other than the active one; null when no space narrows the
 * picker. A project counts as in-space when any of its repos is (spaceless repos join every space).
 */
export function resolveOutOfSpaceProjectOptionIds(args: {
  options: readonly NewWorkspaceProjectOption[]
  scope: SpaceMembership | null
  repoIdsByProjectId: ReadonlyMap<string, readonly string[]>
}): ReadonlySet<string> | null {
  const { options, scope, repoIdsByProjectId } = args
  if (!scope) {
    return null
  }
  const outOfSpace = new Set<string>()
  for (const option of options) {
    const inSpace =
      option.kind === 'project-group'
        ? scope.groupIds.has(option.projectGroupId)
        : isProjectInSpace(repoIdsByProjectId.get(option.projectId), scope.repoIds)
    if (!inSpace) {
      outOfSpace.add(option.id)
    }
  }
  return outOfSpace
}

/**
 * Sections for a space-narrowed picker: the active space's projects in the usual sections, plus
 * an "Other spaces" tail that only appears while a search is live.
 */
export function sectionProjectOptionsBySpace(
  matches: readonly ScoredProjectOption[],
  query: string,
  recentIds: readonly string[],
  outOfSpaceIds: ReadonlySet<string> | null | undefined
): ProjectOptionSection[] {
  if (!outOfSpaceIds || outOfSpaceIds.size === 0) {
    return sectionProjectOptions(matches, query, recentIds)
  }
  const inSpace = matches.filter((match) => !outOfSpaceIds.has(match.option.id))
  const sections = sectionProjectOptions(inSpace, query, recentIds).filter(
    (section) => section.items.length > 0
  )
  if (query.trim() === '') {
    return sections
  }
  const otherSpaces = matches.filter((match) => outOfSpaceIds.has(match.option.id))
  if (otherSpaces.length === 0) {
    return sections
  }
  return [
    ...sections,
    {
      key: 'other-spaces',
      heading: translate(
        'auto.components.new.workspace.ProjectCombobox.otherSpaces',
        'Other spaces'
      ),
      items: otherSpaces
    }
  ]
}
