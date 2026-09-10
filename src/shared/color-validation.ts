// Why: Ghostty allows colors with or without the leading hash.
export const HEX_COLOR_RE = /^#?([0-9a-fA-F]{3}){1,2}$/

/** Coerce a value to canonical `#rrggbb`, or null when it is not a valid hex color. */
export function normalizeHexColor(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  if (!HEX_COLOR_RE.test(trimmed)) {
    return null
  }
  const withoutHash = trimmed.startsWith('#') ? trimmed.slice(1) : trimmed
  const expanded =
    withoutHash.length === 3
      ? withoutHash
          .split('')
          .map((character) => `${character}${character}`)
          .join('')
      : withoutHash
  return `#${expanded.toLowerCase()}`
}

/** Perceived luminance (0..1) of a hex color; used to pick light/dark treatments. */
export function hexColorLuminance(value: string): number {
  const hex = normalizeHexColor(value) ?? '#000000'
  const r = Number.parseInt(hex.slice(1, 3), 16) / 255
  const g = Number.parseInt(hex.slice(3, 5), 16) / 255
  const b = Number.parseInt(hex.slice(5, 7), 16) / 255
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
