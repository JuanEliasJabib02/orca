import type { WorktreeCardController } from '../controller/use-worktree-card-controller'
import { WorktreeCardSpotlightRootBar } from '../../worktree-card-spotlight-items'
import { SpotlightPrimaryBadge, SpotlightQuickAction } from '../../WorktreeCardSpotlightControls'
import { cardElement } from './card-template-compiler'

type Card = WorktreeCardController
const part = cardElement<Card>

/** The repo's Spotlight on a card: the root's bar and badge, and each workspace's toggle. */
export const CARD_SPOTLIGHT_PARTS = {
  SpotlightRootBar: part([], () => <WorktreeCardSpotlightRootBar />),
  SpotlightPrimaryBadge: part([], (_props, _children, { repo }) =>
    repo ? <SpotlightPrimaryBadge repo={repo} /> : null
  ),
  SpotlightQuickAction: part([], (_props, _children, { worktree, repo }) =>
    repo ? <SpotlightQuickAction worktree={worktree} repo={repo} /> : null
  )
}
