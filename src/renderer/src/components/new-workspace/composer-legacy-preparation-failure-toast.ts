import { toast } from 'sonner'
import { useAppStore } from '@/store/index'
import { translate } from '@/i18n/i18n'
import {
  formatWorkspaceCreateError,
  getWorkspaceCreateErrorToastMessage
} from '@/lib/workspace-create-error-format'

/**
 * Reports a quick create whose legacy preparation failed after the composer closed. Reopen
 * restores the composer from `snapshot`, unless the submit was cancelled or another modal is up.
 */
export function showComposerLegacyPreparationFailureToast(
  error: unknown,
  snapshot: Record<string, unknown>,
  isSubmissionCancelled: () => boolean
): void {
  toast.error(getWorkspaceCreateErrorToastMessage(formatWorkspaceCreateError(error)), {
    action: {
      label: translate('auto.lib.composerCreateHandoff.reopen', 'Reopen'),
      onClick: () => {
        if (!isSubmissionCancelled() && useAppStore.getState().activeModal === 'none') {
          useAppStore.getState().openModal('new-workspace-composer', snapshot)
        }
      }
    }
  })
}
