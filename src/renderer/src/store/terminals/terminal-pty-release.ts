import { isRemoteRuntimePtyId } from '../../../../shared/remote-runtime/remote-runtime-pty-id'
import { getRepoIdFromWorktreeId } from '../../../../shared/worktree/id'
import { hasWorktreeSleepIntent } from '@/lib/worktree-sleep-intent'
import { selectWorktreesByRepo } from '../workspaces/catalog/workspace-record-fields'
import type { TerminalSlice, TerminalStoreGet, TerminalStoreSet } from './terminal-state'
import {
  consumePendingActivationSpawn,
  getPendingActivationSpawnCount
} from './terminal-pty-identities'

export function createTerminalPtyReleaseActions(
  set: TerminalStoreSet,
  get: TerminalStoreGet
): Pick<TerminalSlice, 'clearTabPtyId'> {
  return {
    clearTabPtyId: (tabId, ptyId) => {
      if (ptyId && get().pendingPtyShutdownIds[ptyId]) {
        // Why: an owner exit can arrive before its post-stop inventory; keep the renderer binding retryable until verification commits.
        return
      }
      let worktreeId: string | null = null
      let wasActivationSpawn = false
      let clearedSpotlightTab = false
      let nextSpotlightLogPtyId: string | null = null
      let isRemoteRuntimeMirror = isRemoteRuntimePtyId(ptyId)
      set((s) => {
        const existingPtyIds = s.ptyIdsByTabId[tabId] ?? []
        const remainingPtyIds = ptyId ? existingPtyIds.filter((id) => id !== ptyId) : []
        let nextTabsByWorktree = s.tabsByWorktree
        for (const [wId, tabs] of Object.entries(s.tabsByWorktree)) {
          const index = tabs.findIndex((t) => t.id === tabId)
          if (index === -1) {
            continue
          }
          worktreeId = wId
          const tab = tabs[index]
          if (getPendingActivationSpawnCount(tab.pendingActivationSpawn) > 0) {
            wasActivationSpawn = true
          }
          if (!ptyId) {
            isRemoteRuntimeMirror =
              existingPtyIds.length > 0 && existingPtyIds.every((id) => isRemoteRuntimePtyId(id))
          }
          // Why: consume pendingActivationSpawn on real activation clears, but keep it when clearing a stale wake-hint id — its fallback spawn still needs the suppression.
          const { pendingActivationSpawn: _unused, ...rest } = tab
          void _unused
          const nextTabPtyId = remainingPtyIds.at(-1) ?? null
          if (tab.spotlightRepoRoot) {
            clearedSpotlightTab = true
            // Why: the log mirror must follow the SAME pane the tab now points at
            // (nextTabPtyId), never a closing split pane — otherwise the server
            // log would capture an unrelated pane's shell noise and the restart
            // trigger would target the wrong pane.
            nextSpotlightLogPtyId = nextTabPtyId
          }
          const shouldRetainActivationSpawn =
            wasActivationSpawn && ptyId != null && !existingPtyIds.includes(ptyId)
          const nextPendingActivationSpawn = shouldRetainActivationSpawn
            ? tab.pendingActivationSpawn
            : consumePendingActivationSpawn(tab.pendingActivationSpawn)
          if (tab.pendingActivationSpawn || tab.ptyId !== nextTabPtyId) {
            const nextTabs = [...tabs]
            nextTabs[index] = {
              ...rest,
              ...(nextPendingActivationSpawn
                ? { pendingActivationSpawn: nextPendingActivationSpawn }
                : {}),
              ptyId: nextTabPtyId
            }
            nextTabsByWorktree = { ...s.tabsByWorktree, [wId]: nextTabs }
          }
          break
        }
        const nextPtyIdsByTabId = { ...s.ptyIdsByTabId }
        if (worktreeId) {
          nextPtyIdsByTabId[tabId] = remainingPtyIds
        } else {
          // Why: repo purge can retire the owning tab before its async exit arrives; don't resurrect an orphan PTY index.
          delete nextPtyIdsByTabId[tabId]
        }
        const nextPendingPaneAccountRestarts = { ...s.pendingPaneAccountRestarts }
        const nextCodexRestartNoticeByPtyId = { ...s.codexRestartNoticeByPtyId }
        if (ptyId) {
          delete nextPendingPaneAccountRestarts[ptyId]
          delete nextCodexRestartNoticeByPtyId[ptyId]
        } else {
          for (const currentPtyId of s.ptyIdsByTabId[tabId] ?? []) {
            delete nextPendingPaneAccountRestarts[currentPtyId]
            delete nextCodexRestartNoticeByPtyId[currentPtyId]
          }
        }
        // Why: an explicit exit drops the dead relay ID; bulk clears retain it for relay grace.
        const nextLastKnownRelay = { ...s.lastKnownRelayPtyIdByTabId }
        if (ptyId && nextLastKnownRelay[tabId] === ptyId) {
          // If last-bound relay slot exits, promote a survivor or later bulk relay clearing makes orphan sweep delete the still-live split tab (#9911).
          const survivingPtyId = remainingPtyIds.at(-1)
          if (survivingPtyId) {
            nextLastKnownRelay[tabId] = survivingPtyId
          } else {
            delete nextLastKnownRelay[tabId]
          }
        }
        return {
          ...(nextTabsByWorktree !== s.tabsByWorktree
            ? { tabsByWorktree: nextTabsByWorktree }
            : {}),
          ptyIdsByTabId: nextPtyIdsByTabId,
          lastKnownRelayPtyIdByTabId: nextLastKnownRelay,
          pendingPaneAccountRestarts: nextPendingPaneAccountRestarts,
          codexRestartNoticeByPtyId: nextCodexRestartNoticeByPtyId
        }
      })
      // Bump activity on PTY exit, but skip intentional shutdowns (suppressed exits) and click-driven pane unmounts (pendingActivationSpawn).
      if (
        worktreeId &&
        !wasActivationSpawn &&
        !isRemoteRuntimeMirror &&
        !hasWorktreeSleepIntent(worktreeId) &&
        !(ptyId && get().suppressedPtyExitIds[ptyId])
      ) {
        get().bumpWorktreeActivity(worktreeId)
      }

      if (clearedSpotlightTab && worktreeId) {
        const repoId = getRepoIdFromWorktreeId(worktreeId)
        const isMainWorktreeTab = selectWorktreesByRepo(get())[repoId]?.some(
          (entry) => entry.id === worktreeId && entry.isMainWorktree
        )
        if (isMainWorktreeTab) {
          if (nextSpotlightLogPtyId) {
            // The Spotlight tab still has a live pane; keep mirroring from it.
            void window.api.spotlight?.setLogPty?.({ repoId, ptyId: nextSpotlightLogPtyId })
          } else {
            void window.api.spotlight?.clearLogPty?.({ repoId })
          }
        }
      }
    }
  }
}
