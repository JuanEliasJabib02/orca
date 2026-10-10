import { describe, expect, it } from 'vitest'
import { FLOATING_TERMINAL_WORKTREE_ID } from '../constants'
import { LOCAL_EXECUTION_HOST_ID, type ExecutionHostId } from '../execution-host'
import type { WorkspaceSessionState } from '../workspace-session-state-types'
import { loadWorkspaceLayout } from './workspace-layout-load'
import { checkWorkspaceLayoutModelRules } from './workspace-layout-model-rules'
import { checkWorkspaceLayoutRules } from './workspace-layout-rules'
import { saveWorkspaceLayout } from './workspace-layout-save'
import {
  localDesktopSession,
  relaySshSession,
  serverRuntimeSession
} from './workspace-layout-profile.test-fixture'
import { addWorkspace, emptySession, GIT_KEY, leaf } from './workspace-layout-session.test-fixture'

/** What reaches disk: the profile documents are JSON, so an undefined field is a missing one. */
const onDisk = (session: WorkspaceSessionState): unknown => JSON.parse(JSON.stringify(session))

function mintLeafIds(): () => string {
  let next = 0
  return () => `00000000-0000-4000-8000-${String(++next).padStart(12, '0')}`
}

function mintIds(): () => string {
  let next = 0
  return () => `minted-${++next}`
}

function roundTrip(hostId: ExecutionHostId, session: WorkspaceSessionState) {
  const loaded = loadWorkspaceLayout(hostId, session, {
    mintId: mintIds(),
    mintLeafId: mintLeafIds()
  })
  return { loaded, saved: saveWorkspaceLayout(loaded) }
}

const PROFILES: [string, ExecutionHostId, () => WorkspaceSessionState][] = [
  [
    'local desktop (git worktree, folder workspace, all tab kinds)',
    LOCAL_EXECUTION_HOST_ID,
    localDesktopSession
  ],
  [
    'floating terminal',
    LOCAL_EXECUTION_HOST_ID,
    () =>
      addWorkspace(emptySession(), FLOATING_TERMINAL_WORKTREE_ID, [
        { id: 'group-floating', tabs: [{ id: 'tab-floating', leaves: [[leaf(1), 'floating@@1']] }] }
      ])
  ],
  ['relay SSH host partition', 'ssh:target-1', () => relaySshSession('target-1')],
  ['remote server partition', 'runtime:env-1', () => serverRuntimeSession('env-1')],
  ['empty profile', LOCAL_EXECUTION_HOST_ID, emptySession]
]

describe('workspace layout Loader and Serializer', () => {
  it.each(PROFILES)(
    '%s: save(load(stored)) writes exactly what was stored',
    (_name, hostId, build) => {
      const stored = build()
      const before = structuredClone(stored)
      const { loaded, saved } = roundTrip(hostId, stored)
      expect(loaded.changes).toEqual([])
      expect(onDisk(saved)).toEqual(onDisk(stored))
      // The Loader never edits the Store's object.
      expect(stored).toEqual(before)
    }
  )

  it.each(PROFILES)('%s: a second round trip changes nothing', (_name, hostId, build) => {
    const once = roundTrip(hostId, build()).saved
    const twice = roundTrip(hostId, once)
    expect(twice.loaded.changes).toEqual([])
    expect(onDisk(twice.saved)).toEqual(onDisk(once))
  })

  it.each(PROFILES)(
    '%s: the model obeys the structural rules the stored partition obeys',
    (_name, hostId, build) => {
      const stored = build()
      const { loaded } = roundTrip(hostId, stored)
      expect(checkWorkspaceLayoutRules([{ hostId, session: stored }])).toEqual([])
      expect(checkWorkspaceLayoutModelRules([loaded.layout])).toEqual([])
    }
  )

  it('keeps one record per tab and per-view state out of the model', () => {
    const { loaded } = roundTrip(LOCAL_EXECUTION_HOST_ID, localDesktopSession())
    const layoutJson = JSON.stringify(loaded.layout)
    for (const perView of [
      'activeTabId',
      'recentTabIds',
      'activeLeafId',
      'expandedLeafId',
      'lastFocusedAt',
      'dirtyDraftContent',
      'sortOrder'
    ]) {
      expect(layoutJson).not.toContain(`"${perView}"`)
    }
    const workspace = loaded.layout.workspaces['repo-1::/Users/dev/orca']!
    expect(workspace.tabs.map((tab) => [tab.id, tab.kind])).toEqual([
      ['tab-shell', 'terminal'],
      ['tab-agent', 'terminal'],
      ['editor:src/app.ts', 'editor'],
      ['browser-1', 'browser'],
      ['agent-session-1', 'agent-session'],
      ['tab-unbound', 'terminal']
    ])
    // tab-agent's terminal id is term-agent: its pane's data is keyed by leaf alone, and the
    // round trip above saved its pane records under the terminal id.
    expect(workspace.leaves?.[leaf(3)]).toMatchObject({
      incarnationId: 'inc-3',
      sleeping: { agent: 'claude' }
    })
    expect(workspace.groups.map((group) => group.tabOrder)).toEqual([
      ['tab-shell', 'tab-agent', 'editor:src/app.ts'],
      ['browser-1', 'agent-session-1', 'tab-unbound']
    ])
    expect(loaded.desktopView.groups['repo-1::/Users/dev/orca']!['group-a']).toEqual({
      activeTabId: 'tab-agent',
      recentTabIds: ['tab-shell', 'tab-agent']
    })
    expect(loaded.desktopView.editorDrafts['repo-1::/Users/dev/orca']).toEqual({
      '/Users/dev/orca/src/app.ts': {
        dirtyDraftContent: 'export {}\n',
        lastKnownDiskSignature: 'sig-1'
      }
    })
  })

  it('keeps the Spotlight marker on a repo root terminal through a save and reload', () => {
    // Spotlight finds its repo root terminal by this flag after an app restart.
    const stored = addWorkspace(emptySession(), GIT_KEY, [
      {
        id: 'group-spotlight',
        tabs: [
          {
            id: 'tab-spotlight',
            leaves: [[leaf(1), `${GIT_KEY}@@spot0001`]],
            row: { spotlightRepoRoot: true }
          }
        ]
      }
    ])
    const { loaded, saved } = roundTrip(LOCAL_EXECUTION_HOST_ID, stored)
    const tab = loaded.layout.workspaces[GIT_KEY]!.tabs[0]!
    expect(tab.kind === 'terminal' ? tab.terminal.spotlightRepoRoot : undefined).toBe(true)
    expect(loaded.changes).toEqual([])
    expect(saved.tabsByWorktree[GIT_KEY]?.[0]?.spotlightRepoRoot).toBe(true)
    expect(onDisk(saved)).toEqual(onDisk(stored))
  })
})
