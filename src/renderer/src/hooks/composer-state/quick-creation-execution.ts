import type { QuickCreationExecutionInput } from './composer-model'

import { resolveQuickCreateLinkedWorkItemPrompt } from '@/lib/linked-work-item-context'
import { useCallback } from 'react'
import type { Repo } from '../../../../shared/repo-types'
import type { TuiAgent } from '../../../../shared/agent-launch/catalog/tui-agent'
import type { WorktreeCreationRequest } from '@/lib/workspace/creation/pending-worktree-creation'
import { useAppStore } from '@/store'
import { isWorkspaceStatusAllowedOnHost } from '@/store/workspaces/status/host-workspace-status-columns'
import { settleComposerSubmit } from '@/lib/composer-submit-cancellation'
import type { ComposerCreateHandoff } from '@/lib/composer-create-handoff'
import { translate } from '@/i18n/i18n'
import { prepareQuickComposerStartup } from './quick-startup-plan'
import { buildQuickCreationRequest } from './quick-creation-request'
import type { ComposerQuickSubmitOptions } from './composer-submit-model'
import type { PendingSmartGitHubSubmitResolution } from './source-selection-decisions'
import { resolveAgentSessionLaunchRoute } from '@/lib/agent-session/launch/routing/agent-session-launch-plan'
import { prepareStoreCompanionWorktrees } from './companion-worktree-creation-deps'
import type { CompanionLaunchPlan } from './multi-repo-worktree-creation'
import { launchPrimaryWorktreeWithHandoff } from './primary-worktree-handoff-launch'

export function useQuickCreationExecution(input: QuickCreationExecutionInput) {
  const {
    clearNewWorkspaceDraft,
    createMultiple,
    effectivePresetId,
    ephemeralVmRecipes,
    ephemeralVmsEnabled,
    isSubmissionCancelled,
    linkedGitLabIssue,
    linkedGitLabMR,
    normalizedSparseDirectories,
    onCreated,
    parentWorktreeId,
    persistDraft,
    persistSetupAgentStartupPolicy,
    prepareQuickSubmit,
    resetForNextCreate,
    resolvedInitialWorkspaceStatus,
    selectedEphemeralVmRecipeId,
    selectedRepoAgentLaunchFact,
    selectedRepoExecutionHostId,
    selectedRepoIsGit,
    selectedRepoIsRemote,
    selectedRepoTarget,
    selectedRepoStartupShell,
    selectedWorkspaceTarget,
    settings,
    sparseEnabled,
    taskSourceContext,
    telemetrySource
  } = input

  const executeQuickCreation = useCallback(
    async (
      smartGitHubResolution: PendingSmartGitHubSubmitResolution,
      requestedAgent: TuiAgent | null,
      workspaceNameSeed: string,
      workspaceRunContext: WorktreeCreationRequest['workspaceRunContext'],
      repoId: string,
      options?: ComposerQuickSubmitOptions,
      handoff?: ComposerCreateHandoff,
      selectedRepo?: Repo
    ): Promise<void> => {
      const prepared = await prepareQuickSubmit(
        smartGitHubResolution,
        requestedAgent,
        workspaceNameSeed
      )

      if (!prepared) {
        return
      }

      const {
        submitLinkedWorkItem,
        agent,
        submitLinkedIssueNumber,
        submitLinkedPR,
        workspaceName,
        nameWasGenerated,
        nameIsAutoManaged,
        submitCompareBaseRef,
        submitPushTarget,
        effectiveSetupDecision,
        hookPreparation,
        linkedLinearIssue,
        linkedLinearIssueWorkspaceId,
        linkedLinearIssueOrganizationUrlKey,
        branchIntent,
        submitBaseBranch,
        createDisplayName,
        trimmedNote
      } = prepared

      const promptLinkedWorkItem = agent === null ? null : submitLinkedWorkItem

      const { prompt: quickPrompt, draftPrompt: quickDraftPrompt } =
        resolveQuickCreateLinkedWorkItemPrompt(promptLinkedWorkItem, trimmedNote)

      const startupPolicySettlement = await settleComposerSubmit(
        persistSetupAgentStartupPolicy(),
        isSubmissionCancelled
      )

      if (startupPolicySettlement.status === 'cancelled') {
        return
      }

      if (!startupPolicySettlement.value) {
        throw new Error(
          translate(
            'auto.hooks.useComposerState.setupAgentStartupPolicySaveFailed',
            'Failed to save setup startup behavior.'
          )
        )
      }

      let ephemeralVmRecipe: WorktreeCreationRequest['ephemeralVmRecipe']

      const activeEphemeralVmRecipeId = ephemeralVmsEnabled ? selectedEphemeralVmRecipeId : null

      if (activeEphemeralVmRecipeId && selectedWorkspaceTarget.status === 'ready') {
        const selectedRecipe = ephemeralVmRecipes.find(
          (recipe) => recipe.id === activeEphemeralVmRecipeId
        )
        ephemeralVmRecipe = {
          sourceRepoId: repoId,
          recipeId: activeEphemeralVmRecipeId,
          projectId: selectedWorkspaceTarget.target.projectId,
          ...(selectedRecipe?.checkoutMode ? { checkoutMode: selectedRecipe.checkoutMode } : {})
        }
      }

      const launchHostId = ephemeralVmRecipe
        ? 'runtime:pending-ephemeral-vm'
        : (workspaceRunContext?.hostId ?? selectedRepoExecutionHostId ?? undefined)
      // Why before the primary: its agent needs the companions' real paths for `--add-dir`.
      const companionPlan: CompanionLaunchPlan = selectedRepo
        ? await prepareStoreCompanionWorktrees({
            submit: options?.companions,
            primaryRepo: selectedRepo,
            primary: prepared,
            agentCanReachCompanions: !ephemeralVmRecipe,
            launchHostId,
            workspaceStatus: resolvedInitialWorkspaceStatus,
            telemetrySource,
            isCancelled: isSubmissionCancelled
          })
        : {
            addDirPaths: [],
            branchNameOverride: prepared.effectiveBranchNameOverride,
            pendingFirstAgentMessageRename: prepared.pendingFirstAgentMessageRename,
            createdCompanions: []
          }

      const promptDelivery = quickDraftPrompt ? 'draft' : 'auto-submit'
      // Why: the verdict is persisted on the request as data and re-entered once the worktree exists.
      const agentLaunchRoute = !agent
        ? 'terminal-tui'
        : (options?.launchChoice?.route ??
          resolveAgentSessionLaunchRoute(useAppStore.getState(), {
            agent,
            workspace: {
              kind: selectedRepoIsGit ? 'git-worktree' : 'folder',
              repoId,
              executionHostId: launchHostId
            },
            prompt: quickDraftPrompt ?? quickPrompt,
            promptDelivery
          }))
      const structuredLaunch = agentLaunchRoute === 'structured-native-chat'

      const quickStartup = await prepareQuickComposerStartup({
        agent,
        linkedWorkItem: submitLinkedWorkItem,
        note: trimmedNote,
        repoId,
        executionHostId: selectedRepoExecutionHostId,
        settings,
        launchHost: selectedRepoAgentLaunchFact,
        shell: selectedRepoStartupShell,
        isRemote: selectedRepoIsRemote,
        telemetrySource,
        route: agentLaunchRoute,
        launchInputs: options?.launchInputs,
        legacyLaunchInputs: options?.legacyLaunchInputs,
        ephemeralVm: Boolean(ephemeralVmRecipe),
        addDirPaths: companionPlan.addDirPaths
      })

      // Created companions commit the submit; the primary launch decides what a dismissal skips.
      if (isSubmissionCancelled() && companionPlan.createdCompanions.length === 0) {
        return
      }
      if (quickStartup.creationStartup) {
        quickStartup.creationStartup.onLegacyPreparationFailure =
          options?.onLegacyPreparationFailure
      }
      const request = buildQuickCreationRequest({
        repoId,
        ephemeralVmRecipe,
        indeterminateProgress:
          Boolean(activeEphemeralVmRecipeId) || selectedRepoTarget?.kind === 'environment',
        taskSourceContext,
        linkedWorkItem: submitLinkedWorkItem,
        workspaceRunContext,
        workspaceName,
        nameWasGenerated,
        displayName: createDisplayName,
        displayNameKind: createDisplayName ? (nameIsAutoManaged ? 'generated' : 'user') : undefined,
        selectedRepoIsGit,
        baseBranch: submitBaseBranch,
        compareBaseRef: submitCompareBaseRef,
        setupDecision: effectiveSetupDecision,
        sparseDirectories: selectedRepoIsGit && sparseEnabled ? normalizedSparseDirectories : null,
        sparsePresetId: effectivePresetId,
        telemetrySource,
        linkedIssue: submitLinkedIssueNumber,
        linkedPR: submitLinkedPR,
        pushTarget: submitPushTarget,
        agent,
        agentLaunchRoute,
        launchInputs: options?.launchInputs,
        legacyLaunchInputs: options?.legacyLaunchInputs,
        creationStartup: quickStartup.creationStartup,
        linkedLinearIssue,
        linkedLinearIssueWorkspaceId,
        linkedLinearIssueOrganizationUrlKey,
        branchNameOverride: companionPlan.branchNameOverride,
        branchIntent,
        parentWorktreeId,
        // A lane's host-only column applies only when creating on that host.
        workspaceStatus:
          resolvedInitialWorkspaceStatus &&
          isWorkspaceStatusAllowedOnHost(
            useAppStore.getState(),
            {
              hostId: workspaceRunContext?.hostId ?? selectedRepoExecutionHostId,
              runtimeOwnerEnvironmentId:
                selectedRepoTarget?.kind === 'environment' ? selectedRepoTarget.environmentId : null
            },
            resolvedInitialWorkspaceStatus
          )
            ? resolvedInitialWorkspaceStatus
            : undefined,
        linkedGitLabMR,
        linkedGitLabIssue,
        includeGitLabLinks: smartGitHubResolution.kind === 'none',
        startup: structuredLaunch ? undefined : quickStartup.backendStartup,
        hookPreparation: ephemeralVmRecipe
          ? {
              ...hookPreparation,
              executionHostId: selectedRepoExecutionHostId ?? undefined,
              confirmVmRecipe: true
            }
          : hookPreparation,
        pendingFirstAgentMessageRename: companionPlan.pendingFirstAgentMessageRename,
        note: trimmedNote,
        startupPlan: quickStartup.startupPlan,
        quickPrompt,
        launchDraftPrompt: quickDraftPrompt,
        promptDelivery,
        quickTelemetry: quickStartup.telemetry,
        suppressTerminalFocusOnCompletion: createMultiple,
        setupOnly: options?.setupOnly === true
      })

      launchPrimaryWorktreeWithHandoff({
        request,
        createdCompanions: companionPlan.createdCompanions,
        isCancelled: isSubmissionCancelled,
        clearDraft: persistDraft ? clearNewWorkspaceDraft : undefined,
        afterLaunch: createMultiple ? resetForNextCreate : onCreated,
        handoff
      })
    },
    [
      clearNewWorkspaceDraft,
      createMultiple,
      effectivePresetId,
      ephemeralVmRecipes,
      ephemeralVmsEnabled,
      isSubmissionCancelled,
      linkedGitLabIssue,
      linkedGitLabMR,
      normalizedSparseDirectories,
      onCreated,
      parentWorktreeId,
      persistDraft,
      persistSetupAgentStartupPolicy,
      prepareQuickSubmit,
      resetForNextCreate,
      resolvedInitialWorkspaceStatus,
      selectedEphemeralVmRecipeId,
      selectedRepoAgentLaunchFact,
      selectedRepoExecutionHostId,
      selectedRepoIsGit,
      selectedRepoIsRemote,
      selectedRepoTarget,
      selectedRepoStartupShell,
      selectedWorkspaceTarget,
      settings,
      sparseEnabled,
      taskSourceContext,
      telemetrySource
    ]
  )

  return {
    executeQuickCreation
  }
}
