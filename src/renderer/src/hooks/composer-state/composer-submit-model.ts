import type { TuiAgent } from '../../../../shared/agent-launch/catalog/tui-agent'
import type { QuickSubmitOptions } from './quick-creation-request'
import type { GitPushTarget } from '../../../../shared/worktree/types'
import type { SetupDecision } from '../../../../shared/worktree/create-types'
import type { Repo } from '../../../../shared/repo-types'
import type { WorkspaceIntentName } from '../../../../shared/workspace-name'
import type { LinkedWorkItemSummary } from '@/lib/new-workspace'
import type { WorktreeCreationRequest } from '@/lib/workspace/creation/pending-worktree-creation'
import type { ComposerCreateHandoff } from '@/lib/composer-create-handoff'
import type { PendingSmartGitHubSubmitResolution } from './source-selection-decisions'
import type { ComposerCompanionSubmit } from './multi-repo-worktree-creation'

/** A quick create's launch options plus the "Also create in" companion repos. */
export type ComposerQuickSubmitOptions = QuickSubmitOptions & {
  companions?: ComposerCompanionSubmit
}

type SmartCreateNames = {
  workspaceName: string
  displayName: string | undefined
}

export type QuickSubmitSource = {
  submitLinkedWorkItem: LinkedWorkItemSummary | null
  agent: TuiAgent | null
  submitLinkedIssueNumber: number | null
  submitLinkedPR: number | null
  submitTitleName: WorkspaceIntentName | null
  nameIsAutoManaged: boolean
  smartGitHubCreateNames: SmartCreateNames
  workspaceName: string
  nameWasGenerated: boolean
  smartSubmitBaseBranch: string | undefined
  submitCompareBaseRef: string | undefined
  submitPushTarget: GitPushTarget | undefined
  submitBranchNameOverride: string | undefined
}

export type PreparedQuickSubmit = QuickSubmitSource & {
  branchIntent?: WorktreeCreationRequest['branchIntent']
  effectiveSetupDecision: SetupDecision
  hookPreparation: WorktreeCreationRequest['hookPreparation']
  linkedLinearIssue: string | undefined
  linkedLinearIssueWorkspaceId: string | undefined
  linkedLinearIssueOrganizationUrlKey: string | undefined
  effectiveBranchNameOverride: string | undefined
  submitBaseBranch: string | undefined
  createDisplayName: string | undefined
  pendingFirstAgentMessageRename: boolean
  trimmedNote: string
}

export type ComposerSubmitModel = {
  executeQuickCreation: (
    resolution: PendingSmartGitHubSubmitResolution,
    requestedAgent: TuiAgent | null,
    workspaceNameSeed: string,
    workspaceRunContext: WorktreeCreationRequest['workspaceRunContext'],
    repoId: string,
    options?: ComposerQuickSubmitOptions,
    handoff?: ComposerCreateHandoff,
    /** The primary checkout companions are created next to; without it none are. */
    selectedRepo?: Repo
  ) => Promise<void>
  prepareQuickSubmit: (
    resolution: PendingSmartGitHubSubmitResolution,
    requestedAgent: TuiAgent | null,
    workspaceNameSeed: string
  ) => Promise<PreparedQuickSubmit | null>
  prepareQuickSubmitSource: (
    resolution: PendingSmartGitHubSubmitResolution,
    requestedAgent: TuiAgent | null,
    workspaceNameSeed: string
  ) => QuickSubmitSource | null
  resetForNextCreate: () => void
  submitQuick: (agent: TuiAgent | null, options?: ComposerQuickSubmitOptions) => Promise<void>
  submitFolderTarget: (
    requestedAgent: TuiAgent | null,
    options?: QuickSubmitOptions
  ) => Promise<void>
}
