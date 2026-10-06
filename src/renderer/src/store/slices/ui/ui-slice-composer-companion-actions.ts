import type { UISlice, UISliceGet, UISliceSet } from './ui-slice-contract'

/** Keeps only string-keyed string arrays from a hand-editable ui.json, deduped per entry. */
export function sanitizeComposerCompanionRepoIds(value: unknown): Record<string, string[]> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }
  const sanitized: Record<string, string[]> = {}
  for (const [primaryRepoId, companionRepoIds] of Object.entries(value)) {
    if (!Array.isArray(companionRepoIds)) {
      continue
    }
    const ids = [
      ...new Set(
        companionRepoIds.filter(
          (id): id is string => typeof id === 'string' && id !== '' && id !== primaryRepoId
        )
      )
    ]
    if (ids.length > 0) {
      sanitized[primaryRepoId] = ids
    }
  }
  return sanitized
}

function sameIds(a: readonly string[] | undefined, b: readonly string[]): boolean {
  return (a?.length ?? 0) === b.length && b.every((id, index) => a?.[index] === id)
}

export function createUiComposerCompanionActions(
  set: UISliceSet,
  _get: UISliceGet
): Partial<UISlice> {
  return {
    composerCompanionRepoIdsByRepoId: {},
    setComposerCompanionRepoIds: (primaryRepoId, companionRepoIds) =>
      set((s) => {
        const ids = sanitizeComposerCompanionRepoIds({
          [primaryRepoId]: companionRepoIds
        })[primaryRepoId]
        const current = s.composerCompanionRepoIdsByRepoId[primaryRepoId]
        if (sameIds(current, ids ?? [])) {
          return s
        }
        const next = { ...s.composerCompanionRepoIdsByRepoId }
        if (ids) {
          next[primaryRepoId] = ids
        } else {
          delete next[primaryRepoId]
        }
        window.api.ui.set({ composerCompanionRepoIdsByRepoId: next }).catch(console.error)
        return { composerCompanionRepoIdsByRepoId: next }
      })
  }
}
