import { useAppStore } from '@/store'
import { resolveUnifiedTabLabel } from '../../../../../../shared/tab-title-resolution'
import { getRepoIdFromWorktreeId } from '../../../../../../shared/worktree/id'
import { readStructuredChatTabName } from '@/runtime/native-chat/naming/structured-chat-tab-name'
import type { AppState } from '../../../types'

export function resolvePinnedTabLabel(
  state: AppState,
  worktreeId: string,
  visibleId: string
): string {
  const tab = (state.unifiedTabsByWorktree?.[worktreeId] ?? []).find(
    (candidate) => candidate.id === visibleId || candidate.entityId === visibleId
  )
  return tab?.contentType === 'agent-session'
    ? readStructuredChatTabName(tab, state)
    : resolveUnifiedTabLabel(tab, state.settings?.tabAutoGenerateTitle === true)
}

/** Check unified id/entityId pin state before running-process confirmation. */
export function isUnifiedTabPinned(state: AppState, worktreeId: string, tabId: string): boolean {
  return (state.unifiedTabsByWorktree?.[worktreeId] ?? []).some(
    (tab) => (tab.id === tabId || tab.entityId === tabId) && tab.isPinned === true
  )
}

/** Only enabled pin prompts may supersede process confirmation; disabled pin settings must not swallow other warnings (#10142). */
export function shouldConfirmPinnedTabClose(state: AppState): boolean {
  return state.settings?.confirmClosePinnedTab ?? true
}

/** Whether this terminal tab is the repo's Spotlight server terminal while
 *  Spotlight is active — closing it would kill the dev server and the agent
 *  log mirror, so close attempts must go through the off-and-close prompt. */
export function isSpotlightProtectedTab(
  state: AppState,
  worktreeId: string,
  terminalTabId: string
): boolean {
  const tab = (state.tabsByWorktree?.[worktreeId] ?? []).find((entry) => entry.id === terminalTabId)
  if (!tab?.spotlightRepoRoot) {
    return false
  }
  return Boolean(state.spotlightByRepo?.[getRepoIdFromWorktreeId(worktreeId)])
}

/** Centralize pin confirmation across keyboard/native/menu paths; unpinned or disabled-confirmation closes proceed immediately.
 *  A live Spotlight server terminal (`worktreeId`/`terminalTabId`) always prompts: confirming turns Spotlight off before the tab closes. */
export function guardPinnedTabClose(params: {
  isPinned: boolean
  tabLabel: string
  onClose: () => void
  onCancel?: () => void
  worktreeId?: string
  terminalTabId?: string
}): (() => void) | undefined {
  const { isPinned, tabLabel, onClose, onCancel, worktreeId, terminalTabId } = params
  const state = useAppStore.getState()

  if (worktreeId && terminalTabId && isSpotlightProtectedTab(state, worktreeId, terminalTabId)) {
    const request = {
      tabLabel,
      kind: 'spotlight' as const,
      onConfirm: () => {
        const repoId = getRepoIdFromWorktreeId(worktreeId)
        // Close the tab regardless of the deactivate outcome. Closing a
        // terminal is not destructive to git state (the root restore is
        // independent), and gating the close on success made the tab
        // unclosable when restore persistently failed (e.g. a merge in the
        // root). On failure the slice already toasts the reason, and the
        // holder button/context menu can retry the restore.
        void useAppStore
          .getState()
          .deactivateSpotlight(repoId)
          .finally(() => onClose())
      },
      ...(onCancel ? { onCancel } : {})
    }
    state.requestPinnedTabCloseConfirm(request)
    return () => state.cancelPinnedTabCloseRequest(request)
  }

  if (!isPinned) {
    onClose()
    return undefined
  }

  if (!shouldConfirmPinnedTabClose(state)) {
    onClose()
    return undefined
  }

  const request = {
    tabLabel,
    onConfirm: onClose,
    ...(onCancel ? { onCancel } : {})
  }
  state.requestPinnedTabCloseConfirm(request)
  return () => state.cancelPinnedTabCloseRequest(request)
}
