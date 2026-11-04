import React from 'react'

/** Amber left bar on the root's card while the repo's Spotlight is on; the card root must be `relative`. */
export function WorktreeCardSpotlightRootBar(): React.JSX.Element {
  return (
    <span
      aria-hidden
      data-worktree-card-spotlight-bar=""
      className="pointer-events-none absolute inset-y-1 left-0 w-[3px] rounded-full bg-amber-500"
    />
  )
}
