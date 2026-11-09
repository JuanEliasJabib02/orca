/** Opt-in routing of system-browser links into Arc spaces (macOS + Arc only). */
export type ArcSpaceLinkSettings = {
  /** Opt-in (macOS + Arc): system-browser links open in the Arc space mapped to their workspace's sidebar space. */
  openLinksInArcSpaces?: boolean
  /** Arc space name per sidebar space (top-level project group id); a missing or empty name opens normally. */
  arcSpaceNameBySidebarSpaceId?: Record<string, string>
}
