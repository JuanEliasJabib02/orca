import type { WorktreeCardController } from '../controller/use-worktree-card-controller'
import { CARD_ACTIVITY_PARTS } from './card-activity-parts'
import { CARD_IDENTITY_PARTS } from './card-identity-parts'
import { CARD_PRIMITIVES } from './card-primitives'
import { CARD_PROJECT_PARTS } from './card-project-parts'
import { CARD_SPOTLIGHT_PARTS } from './card-spotlight-parts'
import type { CardElementRegistry } from './card-template-compiler'

/** Every element a card template can name: layout and text primitives plus Orca's own parts. */
export const WORKSPACE_CARD_ELEMENTS: CardElementRegistry<WorktreeCardController> = {
  ...CARD_PRIMITIVES,
  ...CARD_IDENTITY_PARTS,
  ...CARD_ACTIVITY_PARTS,
  ...CARD_PROJECT_PARTS,
  ...CARD_SPOTLIGHT_PARTS
}
