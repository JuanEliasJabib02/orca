/** Keep surviving stored order and append missing IDs in input type order. */
export function reconcileTabOrder(
  storedOrder: string[] | undefined,
  terminalIds: string[],
  editorIds: string[],
  browserIds: string[] = [],
  simulatorIds: string[] = [],
  agentSessionIds: string[] = []
): string[] {
  const validIds = new Set([
    ...terminalIds,
    ...editorIds,
    ...browserIds,
    ...simulatorIds,
    ...agentSessionIds
  ])
  // Deduplicate at the render boundary because persisted drop/move/hydration races can leave repeated React keys.
  const result: string[] = []
  const inResult = new Set<string>()
  for (const id of storedOrder ?? []) {
    if (validIds.has(id) && !inResult.has(id)) {
      result.push(id)
      inResult.add(id)
    }
  }
  for (const id of [
    ...terminalIds,
    ...editorIds,
    ...browserIds,
    ...simulatorIds,
    ...agentSessionIds
  ]) {
    if (!inResult.has(id)) {
      result.push(id)
      inResult.add(id)
    }
  }
  return result
}

/**
 * Persist the tab-bar order for a worktree with `newTabId` appended at the end.
 * Without this, reconcileTabOrder falls back to terminals-first when the stored
 * order is unset, jumping a freshly spawned terminal to index 0. Shared by the
 * quick-command and Spotlight tab openers.
 */
export function appendTerminalToPersistedTabOrder(
  state: {
    tabsByWorktree: Record<string, { id: string }[]>
    openFiles: { id: string; worktreeId: string }[]
    browserTabsByWorktree?: Record<string, { id: string }[]>
    tabBarOrderByWorktree: Record<string, string[] | undefined>
    setTabBarOrder: (worktreeId: string, order: string[]) => void
  },
  worktreeId: string,
  newTabId: string
): void {
  const termIds = (state.tabsByWorktree[worktreeId] ?? []).map((t) => t.id)
  const editorIds = state.openFiles.filter((f) => f.worktreeId === worktreeId).map((f) => f.id)
  const browserIds = (state.browserTabsByWorktree?.[worktreeId] ?? []).map((t) => t.id)
  const base = reconcileTabOrder(
    state.tabBarOrderByWorktree[worktreeId],
    termIds,
    editorIds,
    browserIds
  )
  const order = base.filter((id) => id !== newTabId)
  order.push(newTabId)
  state.setTabBarOrder(worktreeId, order)
}
