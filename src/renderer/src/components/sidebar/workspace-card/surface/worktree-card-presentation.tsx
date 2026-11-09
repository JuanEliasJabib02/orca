import React from 'react'
import { getWorkspaceAttachments } from '../../../../../../shared/workspace-attachments/workspace-attachments'

import { getWorktreeCardFrameGeometry } from './worktree-card-frame-geometry'
import '../details/WorktreeCardMeta'
import { hasWorktreeCardDetails } from '../metadata/WorktreeCardMetaBadges'
import {
  renderWorktreeCardIndicators,
  WorktreeCardMetaDetailsHover
} from '../details/worktree-card-details-items'
import type { WorktreeCardController } from '../controller/use-worktree-card-controller'
import { getWorktreeCardProjectLabel } from '../../worktree-card-project-label'
import { canHoldSpotlight } from '../../WorktreeCardSpotlightControls'

function getVisibleContextLabel(
  projectLabel: string | undefined,
  hostLabel: string | undefined,
  showHost: boolean
): string | undefined {
  const labels = [projectLabel, showHost ? hostLabel : undefined].filter(Boolean)
  return labels.length > 0 ? labels.join(' · ') : undefined
}

export function buildWorktreeCardPresentation(card: WorktreeCardController) {
  const {
    worktree,
    repo,
    inPinnedSection,
    hideRepoBadge,
    hostContextLabel,
    showProjectName,
    affiliateListMode,
    flushSurface,
    contentIndent,
    newCardStyle,
    compactCards,
    isFolder,
    groupBy,
    projectGroups,
    detachedHeadDisplay,
    branch,
    identityDisplay,
    folderMetaRowContent,
    showIdentityInNewCard,
    conflictOperation,
    cardProps,
    cardDetails,
    cacheStartedAt,
    hasDetails,
    hasPorts,
    showStatus,
    showInlineAgentList,
    showLineageChildChip,
    remoteBranchConflict,
    visibleCardTitle,
    workspacePorts,
    metaAutomationProvenance,
    metaCliProvenance,
    hoverIssue,
    hoverLinearIssue,
    hoverJiraIssue,
    hoverReview,
    hoverComment,
    showDeleteQuickAction
  } = card

  // Why: pinned trees mix repos, so ordinary rows lead with the project chip; cross-repo children keep the regular project badge.
  const showPinnedRepoIcon = inPinnedSection && !!repo && !showProjectName
  const showInlineRepoBadge =
    cardDetails.repoInTitle && !!repo && !hideRepoBadge && !isFolder && !showPinnedRepoIcon
  const showRepoBadgeInMetaRow =
    !cardDetails.repoInTitle && !!repo && !hideRepoBadge && !showPinnedRepoIcon
  const projectLabel = getWorktreeCardProjectLabel({
    groupBy,
    affiliateListMode,
    repo,
    worktreeRepoId: worktree.repoId,
    projectGroups
  })
  // Why: compact/new titles already truncate, so the name takes its own muted line below instead of an inline suffix.
  const belowTitleProjectLabel = cardDetails.repoInTitle ? projectLabel : null
  // Why: Default cards already name the project in the meta-row repo pill; this fills only where no pill renders.
  const metaRowProjectLabel =
    !cardDetails.repoInTitle && !showRepoBadgeInMetaRow ? projectLabel : null
  const contextLabel = getVisibleContextLabel(
    undefined,
    hostContextLabel,
    cardProps.includes('host')
  )
  const showHostContextBadge = !!contextLabel && (!compactCards || !!showProjectName)
  // The active root wears an amber left bar so "Spotlight running here" reads at a glance.
  const spotlightActive = Boolean(card.spotlight)
  // Suppress the raw detached-HEAD badge only while Spotlight cleanly owns the
  // root — the amber chip already signals that expected detachment. If the root
  // DIVERGED (someone checked out/committed in it), keep the badge: it's real.
  const spotlightCleanlyOwnsRoot =
    Boolean(card.spotlight) && card.spotlight?.lastError?.code !== 'root-diverged'
  const spotlightEligible = canHoldSpotlight(worktree, repo, isFolder)
  const showDetachedHeadInMetaRow =
    cardDetails.metaRow &&
    !isFolder &&
    detachedHeadDisplay !== null &&
    !(worktree.isMainWorktree && spotlightCleanlyOwnsRoot)
  const showBranch =
    !isFolder &&
    branch.length > 0 &&
    !newCardStyle &&
    (!compactCards || branch !== worktree.displayName)
  const showConflictOperationBadge = conflictOperation === 'cherry-pick'
  const hasMetadataBadge = showConflictOperationBadge
  const showUnreadQuickAction = !affiliateListMode && showStatus && !newCardStyle
  // Why: the slot owns the unread/status lane; legacy keeps the bell toggle, the new card keeps the glyph passive.
  const showCombinedStatusSlot = showStatus
  const showTitleRowPrimary = compactCards && worktree.isMainWorktree && !isFolder
  const showMetaRowDetails = !newCardStyle && !compactCards && (hasDetails || hasPorts)
  const showTitleRowIndicators = (newCardStyle || compactCards) && (hasDetails || hasPorts)
  // Why: grouped views can hide the repo badge; don't reserve a blank metadata lane unless there's real content.
  const hasDetailedMetaRowContent = Boolean(
    (showRepoBadgeInMetaRow && repo) ||
    metaRowProjectLabel !== null ||
    showHostContextBadge ||
    folderMetaRowContent ||
    showBranch ||
    showIdentityInNewCard ||
    showDetachedHeadInMetaRow ||
    showConflictOperationBadge ||
    cacheStartedAt != null ||
    showMetaRowDetails
  )
  // Why: without the identity meta row, a compact card keeps a row only for badges and the timer.
  const hasMetaRow = cardDetails.metaRow
    ? hasDetailedMetaRowContent
    : hasMetadataBadge || cacheStartedAt != null
  const showHeaderActions = showTitleRowPrimary || showDeleteQuickAction || spotlightEligible
  const trimmedVisibleCardTitle = visibleCardTitle.trim()
  const showBranchIdentityHover = newCardStyle
    ? Boolean(identityDisplay) &&
      !cardProps.includes('branch') &&
      identityDisplay !== trimmedVisibleCardTitle
    : compactCards && showBranch
  const hoverBranchName = newCardStyle
    ? identityDisplay
    : showBranchIdentityHover
      ? branch
      : undefined
  const hoverWorkspaceTitle =
    trimmedVisibleCardTitle.length > 0 && trimmedVisibleCardTitle !== hoverBranchName
      ? trimmedVisibleCardTitle
      : undefined
  const hasHoverIdentity = Boolean(hoverWorkspaceTitle || hoverBranchName)
  const hasHoverDetails =
    (newCardStyle || compactCards) &&
    (getWorkspaceAttachments(worktree).length > 0 ||
      hasWorktreeCardDetails({
        issue: hoverIssue,
        linearIssue: hoverLinearIssue,
        jiraIssue: hoverJiraIssue,
        review: hoverReview,
        comment: hoverComment,
        automationProvenance: metaAutomationProvenance,
        cliProvenance: metaCliProvenance
      }) ||
      workspacePorts.length > 0 ||
      hasHoverIdentity)
  // Why: the parent row owns metadata hover; don't stack the title's truncation tooltip on the details popover.
  const titleWrapper = hasHoverDetails
    ? (title: React.ReactElement): React.ReactElement => title
    : undefined
  // Why: sidebar rows need a small surface inset while content stays aligned with the pre-inset layout.
  const { cardStyle, parentContentMarginLeft } = getWorktreeCardFrameGeometry({
    flushSurface,
    contentIndent,
    statusLane: newCardStyle && showCombinedStatusSlot
  })
  const detailsAndPortsContent = renderWorktreeCardIndicators(card)
  const detailsAndPorts =
    detailsAndPortsContent && !newCardStyle && !compactCards ? (
      <WorktreeCardMetaDetailsHover card={card}>
        {detailsAndPortsContent}
      </WorktreeCardMetaDetailsHover>
    ) : (
      detailsAndPortsContent
    )
  const titleRowIndicators = showTitleRowIndicators ? (
    <div className="ml-auto flex shrink-0 items-center gap-1 pr-1.5">{detailsAndPorts}</div>
  ) : null
  const hasSecondaryCardContent =
    hasMetaRow ||
    belowTitleProjectLabel !== null ||
    !!remoteBranchConflict ||
    showInlineAgentList ||
    showLineageChildChip
  const titleOnlyCard = !hasSecondaryCardContent

  return {
    showPinnedRepoIcon,
    showInlineRepoBadge,
    showRepoBadgeInMetaRow,
    belowTitleProjectLabel,
    metaRowProjectLabel,
    showHostContextBadge,
    contextLabel,
    showIdentityInNewCard,
    showDetachedHeadInMetaRow,
    showBranch,
    showConflictOperationBadge,
    showUnreadQuickAction,
    showCombinedStatusSlot,
    showTitleRowPrimary,
    showMetaRowDetails,
    showTitleRowIndicators,
    hasMetaRow,
    showHeaderActions,
    showDeleteQuickAction,
    spotlightActive,
    spotlightEligible,
    hoverBranchName,
    hoverWorkspaceTitle,
    hasHoverDetails,
    titleWrapper,
    parentContentMarginLeft,
    cardStyle,
    detailsAndPorts,
    titleRowIndicators,
    titleOnlyCard
  }
}

export type WorktreeCardPresentation = ReturnType<typeof buildWorktreeCardPresentation>
