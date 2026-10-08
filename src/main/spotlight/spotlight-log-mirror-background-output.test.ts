/**
 * The Spotlight terminal usually lives in a background workspace whose pane never mounts. The
 * daemon streams a session's output only to an app that ATTACHED it, and a pane attaches only
 * when it mounts, so a capture that merely listened for data logged nothing but Orca's notes.
 *
 * Harness: real OrcaRuntimeService with a pty controller modeling the daemon boundary — data is
 * deliverable only after attach(id), exactly like the daemon's attached-client fan-out.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import nodePath from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../ipc/pty', () => ({
  getLocalPtyProvider: vi.fn()
}))
vi.mock('../git/runner', () => ({
  gitExecFileAsync: vi.fn(async () => ({ stdout: '.git/info/exclude', stderr: '' }))
}))

import { SPOTLIGHT_LOG_RELATIVE_PATH } from '../../shared/spotlight'
import { OrcaRuntimeService } from '../runtime/orca-runtime'
import type { RuntimePtyController } from '../runtime/runtime-pty-controller-contract'
import { startSpotlightLogCapture, stopSpotlightLogCapture } from './spotlight-log-mirror'
import { configureSpotlightTerminalOutputSource } from './spotlight-terminal-output-source'

const ESC = '\u001b'
const REPO_ID = 'repo-admin'
const WORKTREE_ID = `${REPO_ID}::/repos/admin-action`
const PTY_ID = `${WORKTREE_ID}@@31ab4ab3`

type Harness = {
  runtime: OrcaRuntimeService
  root: string
  attachCalls: string[]
  /** The session as the daemon sees it; absent means the daemon does not know it. */
  session: { attached: boolean } | null
  /** Daemon output for the session: reaches main only when this app attached it. */
  emitDaemonData: (data: string) => boolean
  /** The renderer publishes the persisted tab, pane unmounted, with its live ptyId. */
  publishSpotlightTab: () => void
}

const roots: string[] = []

afterEach(() => {
  stopSpotlightLogCapture({ repoId: REPO_ID })
  configureSpotlightTerminalOutputSource(null)
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

function setup(): Harness {
  const root = mkdtempSync(nodePath.join(tmpdir(), 'orca-spotlight-background-'))
  roots.push(root)
  mkdirSync(nodePath.join(root, '.git', 'info'), { recursive: true })
  const runtime = new OrcaRuntimeService()
  const harness: Harness = {
    runtime,
    root,
    attachCalls: [],
    session: { attached: false },
    emitDaemonData: (data) => {
      if (!harness.session?.attached) {
        return false
      }
      runtime.onPtyData(PTY_ID, data, Date.now())
      return true
    },
    publishSpotlightTab: () => {
      runtime.syncWindowGraph(1, {
        tabs: [
          {
            tabId: 'spotlight-tab',
            worktreeId: WORKTREE_ID,
            title: 'Spotlight',
            activeLeafId: 'leaf-1',
            layout: null
          }
        ],
        leaves: [
          {
            tabId: 'spotlight-tab',
            worktreeId: WORKTREE_ID,
            leafId: 'leaf-1',
            paneRuntimeId: 1,
            ptyId: PTY_ID
          }
        ]
      })
    }
  }
  const controller: RuntimePtyController = {
    write: () => true,
    kill: () => true,
    getForegroundProcess: async () => null,
    // Attach-only, like the daemon: an unknown session is refused, never created.
    attach: async (ptyId) => {
      harness.attachCalls.push(ptyId)
      if (!harness.session) {
        return false
      }
      harness.session.attached = true
      return true
    }
  }
  runtime.setPtyController(controller)
  configureSpotlightTerminalOutputSource(runtime)
  return harness
}

function readLog(root: string): string {
  const logPath = nodePath.join(root, ...SPOTLIGHT_LOG_RELATIVE_PATH.split('/'))
  return existsSync(logPath) ? readFileSync(logPath, 'utf-8') : ''
}

describe('Spotlight log mirror: background terminal output', () => {
  it('mirrors a daemon session no pane has attached', async () => {
    const harness = setup()
    harness.publishSpotlightTab()
    // Baseline: nothing attached the session in this app run, so the daemon emits nothing.
    expect(harness.emitDaemonData('lost before capture\r\n')).toBe(false)

    await startSpotlightLogCapture({ repoId: REPO_ID, ptyId: PTY_ID, rootPath: harness.root })

    await vi.waitFor(() => expect(harness.attachCalls).toEqual([PTY_ID]))
    // An output observer is not a view: query replies and stream thinning stay unchanged.
    expect(harness.runtime.hasRemoteTerminalViewSubscriber(PTY_ID)).toBe(false)
    expect(harness.runtime.hasRawTerminalViewSubscriber(PTY_ID)).toBe(false)

    expect(
      harness.emitDaemonData(`${ESC}[32m✓ Ready in 1.2s${ESC}[0m\r\n GET /es/inventory 200\r\n`)
    ).toBe(true)
    await vi.waitFor(() => expect(readLog(harness.root)).toContain('✓ Ready in 1.2s'))
    expect(readLog(harness.root)).toContain('GET /es/inventory 200')
    expect(readLog(harness.root)).not.toContain('lost before capture')
  })

  it('stops mirroring once the capture stops', async () => {
    const harness = setup()
    harness.publishSpotlightTab()
    await startSpotlightLogCapture({ repoId: REPO_ID, ptyId: PTY_ID, rootPath: harness.root })
    await vi.waitFor(() => expect(harness.attachCalls).toEqual([PTY_ID]))

    stopSpotlightLogCapture({ repoId: REPO_ID })
    harness.emitDaemonData('after turn-off\r\n')
    await new Promise((resolve) => setTimeout(resolve, 150))

    expect(readLog(harness.root)).not.toContain('after turn-off')
  })

  it('does not re-attach a session a pane already attached in this run', async () => {
    const harness = setup()
    harness.publishSpotlightTab()
    // A pane spawn/reattach through this app attaches the session at spawn time.
    harness.runtime.onPtySpawned(PTY_ID, undefined, { awaitsRegistration: false })
    if (harness.session) {
      harness.session.attached = true
    }

    await startSpotlightLogCapture({ repoId: REPO_ID, ptyId: PTY_ID, rootPath: harness.root })
    harness.emitDaemonData('mounted pane output\r\n')

    await vi.waitFor(() => expect(readLog(harness.root)).toContain('mounted pane output'))
    expect(harness.attachCalls).toEqual([])
  })

  it('retries the attach when the same terminal is registered again', async () => {
    const harness = setup()
    // The capture can start before the runtime has seen the renderer's graph.
    await startSpotlightLogCapture({ repoId: REPO_ID, ptyId: PTY_ID, rootPath: harness.root })
    expect(harness.attachCalls).toEqual([])

    harness.publishSpotlightTab()
    await startSpotlightLogCapture({ repoId: REPO_ID, ptyId: PTY_ID, rootPath: harness.root })

    await vi.waitFor(() => expect(harness.attachCalls).toEqual([PTY_ID]))
    expect(harness.emitDaemonData('late attach output\r\n')).toBe(true)
    await vi.waitFor(() => expect(readLog(harness.root)).toContain('late attach output'))
  })

  it('retries after the daemon refused an attach for a session it did not know yet', async () => {
    const harness = setup()
    harness.publishSpotlightTab()
    harness.session = null
    await startSpotlightLogCapture({ repoId: REPO_ID, ptyId: PTY_ID, rootPath: harness.root })
    await vi.waitFor(() => expect(harness.attachCalls).toEqual([PTY_ID]))
    // Let the refused attach settle so it no longer counts as pending.
    await new Promise((resolve) => setTimeout(resolve, 0))

    harness.session = { attached: false }
    await startSpotlightLogCapture({ repoId: REPO_ID, ptyId: PTY_ID, rootPath: harness.root })

    await vi.waitFor(() => expect(harness.attachCalls).toEqual([PTY_ID, PTY_ID]))
    expect(harness.emitDaemonData('after refusal\r\n')).toBe(true)
    await vi.waitFor(() => expect(readLog(harness.root)).toContain('after refusal'))
  })
})
