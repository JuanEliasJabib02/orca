import React from 'react'

import { cn } from '@/lib/utils'
import { getWorkspaceAttachments } from '../../../../../../shared/workspace-attachments/workspace-attachments'
import { WorktreeCardHeader } from './worktree-card-header'
import { WorktreeCardMetaRow } from '../metadata/worktree-card-meta-row'
import { WorktreeCardIdentityHover } from '../details/worktree-card-details-items'
import type { WorktreeCardPresentation } from './worktree-card-presentation'
import { WorktreeCardProjectLabel } from './worktree-card-project-label'
import { WorktreeCardSecondaryRows } from './worktree-card-secondary-rows'
import { WorktreeCardSpotlightRootBar } from './worktree-card-spotlight-items'
import { WorktreeCardStatusLane } from './worktree-card-status-lane'
import type { WorktreeCardController } from '../controller/use-worktree-card-controller'

export function WorktreeCardParentContent({
  card,
  presentation
}: {
  card: WorktreeCardController
  presentation: WorktreeCardPresentation
}): React.JSX.Element {
  const { worktree, showInlineAgentList, titleRenaming } = card
  const {
    titleOnlyCard,
    parentContentMarginLeft,
    showCombinedStatusSlot,
    showUnreadQuickAction,
    hasHoverDetails,
    hoverBranchName,
    hoverWorkspaceTitle,
    belowTitleProjectLabel
  } = presentation

  const identityContent = (
    <div
      className="group/worktree-card flex w-full min-w-0 flex-col gap-1.5"
      data-worktree-card-hover-trigger=""
    >
      <WorktreeCardHeader card={card} presentation={presentation} />
      {belowTitleProjectLabel !== null && (
        // Why: invisible, not unmounted, while renaming so the row keeps its measured height.
        <WorktreeCardProjectLabel
          label={belowTitleProjectLabel}
          tooltipEnabled={!hasHoverDetails}
          className={cn('-mt-1', titleRenaming && 'invisible')}
        />
      )}
      {presentation.hasMetaRow && <WorktreeCardMetaRow card={card} presentation={presentation} />}
    </div>
  )
  // Why: status glyphs and agent rows own their tooltips; only identity content should open the larger details card.
  const identityContentWithHover =
    hasHoverDetails && !titleRenaming ? (
      <WorktreeCardIdentityHover
        card={card}
        branchName={hoverBranchName}
        workspaceTitle={hoverWorkspaceTitle}
      >
        {identityContent}
      </WorktreeCardIdentityHover>
    ) : (
      identityContent
    )

  return (
    <div
      // Why relative: anchors the Spotlight bar on the primary row.
      className={cn(
        'relative flex w-full min-w-0 gap-0.5',
        titleOnlyCard ? 'items-center' : 'items-start'
      )}
      style={
        parentContentMarginLeft < 0 ? { marginLeft: `${parentContentMarginLeft}px` } : undefined
      }
      data-worktree-card-parent-content=""
    >
      {worktree.isMainWorktree && presentation.spotlightActive && <WorktreeCardSpotlightRootBar />}
      {showCombinedStatusSlot ? (
        <WorktreeCardStatusLane card={card} showUnreadAction={showUnreadQuickAction} />
      ) : null}

      <div
        className={cn(
          'flex min-w-0 flex-1 flex-col gap-1.5',
          // Why: inline agent rows intentionally outdent into the card gutter; inner elements handle truncation.
          showInlineAgentList || getWorkspaceAttachments(worktree).length > 1
            ? 'overflow-visible'
            : 'overflow-hidden'
        )}
      >
        {identityContentWithHover}
        <WorktreeCardSecondaryRows card={card} presentation={presentation} />
      </div>
    </div>
  )
}
