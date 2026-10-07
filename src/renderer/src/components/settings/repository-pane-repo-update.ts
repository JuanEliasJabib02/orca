import type { GhAccountBinding } from '../../../../shared/github/account-binding'
import type { Repo } from '../../../../shared/repo-types'

/** Repo fields the settings pane edits; `null` clears the nullable ones. */
export type RepositoryPaneRepoUpdate = Omit<
  Partial<Repo>,
  'sourceControlAi' | 'externalWorktreeVisibility' | 'ghAccount' | 'spotlightServer'
> & {
  sourceControlAi?: Repo['sourceControlAi'] | null
  externalWorktreeVisibility?: Repo['externalWorktreeVisibility'] | null
  ghAccount?: GhAccountBinding | null
  spotlightServer?: Repo['spotlightServer'] | null
}
