// A repo's variants are the apps one Spotlight server can run, one at a time (e.g. landing's
// countries). A server command picks the chosen one through the `{variant}` placeholder.

export const SPOTLIGHT_VARIANT_PLACEHOLDER = '{variant}'

export const MAX_SPOTLIGHT_VARIANT_LENGTH = 64

// Why: the value is typed into a terminal, so only plain tokens are ever substituted.
const SAFE_SPOTLIGHT_VARIANT = /^[A-Za-z0-9_-]+$/

export function isSafeSpotlightVariant(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= MAX_SPOTLIGHT_VARIANT_LENGTH &&
    SAFE_SPOTLIGHT_VARIANT.test(value)
  )
}

export function spotlightCommandNeedsVariant(command: string): boolean {
  return command.includes(SPOTLIGHT_VARIANT_PLACEHOLDER)
}

/** Fills every `{variant}`; null when the command needs one and `variant` is missing or unsafe. */
export function fillSpotlightVariant(
  command: string,
  variant: string | null | undefined
): string | null {
  if (!spotlightCommandNeedsVariant(command)) {
    return command
  }
  return isSafeSpotlightVariant(variant)
    ? command.replaceAll(SPOTLIGHT_VARIANT_PLACEHOLDER, variant)
    : null
}

/** How a variant label reads in the UI (`do` → `DO`). */
export function formatSpotlightVariant(variant: string): string {
  return variant.toUpperCase()
}

/** What a task's branch changed under `apps/<V>/`: exactly one variant, or the candidates (maybe none). */
export type SpotlightVariantInference =
  | { kind: 'inferred'; variant: string }
  | { kind: 'ambiguous'; candidates: string[] }

export function noSpotlightVariantInference(): SpotlightVariantInference {
  return { kind: 'ambiguous', candidates: [] }
}
