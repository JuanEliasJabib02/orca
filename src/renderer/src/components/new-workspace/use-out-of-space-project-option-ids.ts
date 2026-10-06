import { useMemo } from 'react'
import { useAppStore } from '@/store'
import type { Repo } from '../../../../shared/repo-types'
import {
  getNewWorkspaceProjectRepoIds,
  type NewWorkspaceProjectOption
} from '@/lib/new-workspace-project-options'
import { resolveOutOfSpaceProjectOptionIds } from './project-option-space-partition'
import { useComposerSpaceScope } from './use-composer-space-scope'

/** Composer-only: which project options sit in another space, so the picker can tuck them away. */
export function useOutOfSpaceProjectOptionIds(
  options: readonly NewWorkspaceProjectOption[],
  eligibleRepos: readonly Repo[]
): ReadonlySet<string> | null {
  const scope = useComposerSpaceScope()
  const projects = useAppStore((s) => s.projects)
  const projectHostSetups = useAppStore((s) => s.projectHostSetups)
  return useMemo(
    () =>
      scope
        ? resolveOutOfSpaceProjectOptionIds({
            options,
            scope,
            repoIdsByProjectId: getNewWorkspaceProjectRepoIds({
              projects: projects ?? [],
              projectHostSetups: projectHostSetups ?? [],
              eligibleRepos
            })
          })
        : null,
    [eligibleRepos, options, projectHostSetups, projects, scope]
  )
}
