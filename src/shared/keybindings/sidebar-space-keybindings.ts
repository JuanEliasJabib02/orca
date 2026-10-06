import type {
  KeybindingActionId,
  KeybindingInput,
  KeybindingMatchOptions,
  KeybindingOverrides
} from './types'
import { keybindingMatchesAction } from './matching'

// Why: one row per space, in switcher order; spaces past the third have no default key.
export const SIDEBAR_SPACE_KEYBINDING_ACTION_IDS = [
  'sidebar.space.select1',
  'sidebar.space.select2',
  'sidebar.space.select3'
] as const satisfies readonly KeybindingActionId[]

export function getSidebarSpaceKeybindingActionId(index: number): KeybindingActionId | null {
  return Number.isInteger(index) ? (SIDEBAR_SPACE_KEYBINDING_ACTION_IDS[index] ?? null) : null
}

/** Zero-based space index whose binding matches the input, or null. */
export function matchSidebarSpaceKeybindingIndex(
  input: KeybindingInput,
  platform: NodeJS.Platform,
  overrides?: KeybindingOverrides,
  options: KeybindingMatchOptions = {}
): number | null {
  const index = SIDEBAR_SPACE_KEYBINDING_ACTION_IDS.findIndex((actionId) =>
    keybindingMatchesAction(actionId, input, platform, overrides, options)
  )
  return index === -1 ? null : index
}
