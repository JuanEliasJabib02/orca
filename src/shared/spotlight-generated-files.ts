// Files a framework's dev server rewrites in the checkout it runs in. Why: `next dev` (Next 16)
// rewrites the tracked next-env.d.ts on every start ("This file should not be edited"), so a
// Spotlight server running at the root made the root look diverged and blocked turn-off, sync and
// task switches. Changes to these never count as root divergence; the reset of a turn-off or sync
// restores them like any tracked file, and the server writes them again.
const GENERATED_FILE_NAMES: ReadonlySet<string> = new Set(['next-env.d.ts'])

/** `gitPath` (repo-relative, `/`-separated as git prints it) names a known framework-generated
 *  file, at any depth so monorepo apps (`apps/web/next-env.d.ts`) count too. */
export function isSpotlightGeneratedFile(gitPath: string): boolean {
  return GENERATED_FILE_NAMES.has(gitPath.slice(gitPath.lastIndexOf('/') + 1))
}
