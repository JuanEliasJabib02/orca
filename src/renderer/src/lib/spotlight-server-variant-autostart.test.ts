import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SpotlightServerStartResult } from '../../../shared/spotlight'
import type {
  SpotlightServerConfig,
  SpotlightServerScriptDetection
} from '../../../shared/spotlight-server-types'
import type { SpotlightVariantInference } from '../../../shared/spotlight-server-variant'
import {
  makeTestSpotlightState,
  makeTestTab,
  makeTestWorktree,
  resetSpotlightTerminalTestStore,
  spotlightTerminalTestStore,
  type SpotlightTerminalTestData
} from './spotlight-terminal-test-store'

type PromptArgs = {
  repoId: string
  projectName: string
  candidates: readonly string[]
  onPick: (variant: string) => void
}

const prompt = vi.hoisted(() => ({
  show: vi.fn((_args: PromptArgs) => {}),
  dismiss: vi.fn((_repoId: string) => {})
}))

vi.mock('@/store', async () => {
  const { spotlightTerminalTestStore: store } = await import('./spotlight-terminal-test-store')
  return { useAppStore: store }
})
vi.mock('@/components/tab-bar/reconcile-order', () => ({
  appendTerminalToPersistedTabOrder: vi.fn()
}))
vi.mock('@/lib/worktree-activation', () => ({ activateAndRevealWorktree: vi.fn() }))
vi.mock('@/components/terminal/background-terminal-worktree-mount', () => ({
  requestBackgroundTerminalWorktreeMount: vi.fn()
}))
vi.mock('@/components/sidebar/spotlight-variant-prompt-toast', () => ({
  showSpotlightVariantPrompt: prompt.show,
  dismissSpotlightVariantPrompt: prompt.dismiss
}))

import {
  applySpotlightEnvChange,
  chooseSpotlightVariant,
  openSpotlightTerminalAndStartServer
} from './spotlight-server-autostart'

const REPO = 'landing'
const MAIN = makeTestWorktree({ id: 'landing-main', repoId: REPO, isMainWorktree: true })
const TICKET = makeTestWorktree({
  id: 'landing-ax',
  repoId: REPO,
  branch: 'refs/heads/juan/AX-3447-promo',
  displayName: 'promo'
})
const LOCAL = 'pnpm exec dotenv -e .env.{variant} -- pnpm --filter @ae/{variant} dev'
const CONFIG: SpotlightServerConfig = { local: LOCAL, dev: 'pnpm dev:{variant}', port: 3001 }
const COUNTRIES = ['br', 'do', 'ec', 'es', 'gb', 'pt']

const api = {
  repos: {
    detectSpotlightServerScripts: vi.fn(
      async (_args: { repoId: string }): Promise<SpotlightServerScriptDetection> => ({
        detected: { dev: 'pnpm dev:{variant}', prod: 'pnpm prod:{variant}' },
        scriptCommands: [],
        variants: COUNTRIES
      })
    )
  },
  spotlight: {
    setLogPty: vi.fn(async (_args: { repoId: string; ptyId: string }) => {}),
    prepareServerLaunch: vi.fn(
      async (args: { repoId: string; command: string }): Promise<string | null> => args.command
    ),
    cancelPreparedServerLaunch: vi.fn(async (_args: { repoId: string }) => {}),
    startServer: vi.fn(
      async (_args: {
        repoId: string
        command: string
        restartIfDifferent?: boolean
      }): Promise<SpotlightServerStartResult> => ({ ok: true, started: true })
    ),
    inferServerVariant: vi.fn(
      async (_args: {
        repoId: string
        worktreeId: string
      }): Promise<SpotlightVariantInference> => ({
        kind: 'ambiguous',
        candidates: []
      })
    )
  }
}
// @ts-expect-error test window mock
globalThis.window = { api }

function seed(overrides: Partial<SpotlightTerminalTestData> = {}): void {
  resetSpotlightTerminalTestStore({
    repos: [{ id: REPO, displayName: 'landing_action_experience', spotlightServer: CONFIG }],
    worktreesByRepo: { [REPO]: [MAIN, TICKET] },
    tabsByWorktree: {
      [MAIN.id]: [
        makeTestTab({ id: 'spot', worktreeId: MAIN.id, ptyId: 'pty-1', spotlightRepoRoot: true })
      ]
    },
    spotlightByRepo: { [REPO]: makeTestSpotlightState(REPO, TICKET.id) },
    ...overrides
  })
}

function inferred(variant: string): void {
  api.spotlight.inferServerVariant.mockResolvedValueOnce({ kind: 'inferred', variant })
}

function lastPrompt(): PromptArgs {
  const args = prompt.show.mock.calls.at(-1)?.[0]
  if (!args) {
    throw new Error('no variant prompt was shown')
  }
  return args
}

function startedCommand(variant: string): string {
  return `pnpm exec dotenv -e .env.${variant} -- pnpm --filter @ae/${variant} dev --port 3001`
}

function activate(): ReturnType<typeof openSpotlightTerminalAndStartServer> {
  return openSpotlightTerminalAndStartServer({ repoId: REPO, worktreeId: TICKET.id })
}

beforeEach(() => {
  // Reset, not clear: a queued answer a test didn't consume must not leak into the next one.
  vi.resetAllMocks()
  seed()
})

describe('Spotlight autostart with variants', () => {
  it('uses the variant remembered for the task, without asking git', async () => {
    seed({ spotlightVariantByTaskRepo: { 'AX-3447::landing': 'pt' } })
    inferred('do')

    const activation = await activate()

    expect(activation.server).toEqual({ kind: 'started', command: startedCommand('pt') })
    expect(api.spotlight.startServer).toHaveBeenCalledWith({
      repoId: REPO,
      command: startedCommand('pt'),
      restartIfDifferent: true
    })
    expect(api.spotlight.inferServerVariant).not.toHaveBeenCalled()
    expect(prompt.show).not.toHaveBeenCalled()
  })

  it('else infers it from the branch and remembers it for the task', async () => {
    inferred('do')

    const activation = await activate()

    expect(api.spotlight.inferServerVariant).toHaveBeenCalledWith({
      repoId: REPO,
      worktreeId: TICKET.id
    })
    expect(activation.server).toEqual({ kind: 'started', command: startedCommand('do') })
    expect(spotlightTerminalTestStore.getState().spotlightVariantByTaskRepo).toEqual({
      'AX-3447::landing': 'do'
    })
    expect(prompt.show).not.toHaveBeenCalled()
  })

  it('ignores a remembered variant the repo no longer has', async () => {
    seed({ spotlightVariantByTaskRepo: { 'AX-3447::landing': 'mx' } })
    inferred('gb')

    expect((await activate()).server).toEqual({
      kind: 'started',
      command: startedCommand('gb')
    })
  })

  it('asks among the apps the branch touched, naming the project, and starts nothing', async () => {
    api.spotlight.inferServerVariant.mockResolvedValueOnce({
      kind: 'ambiguous',
      candidates: ['do', 'pt']
    })

    const activation = await activate()

    expect(activation.server).toEqual({ kind: 'none' })
    expect(activation.opened).toMatchObject({ ok: true, tabId: 'spot' })
    expect(lastPrompt()).toMatchObject({
      repoId: REPO,
      projectName: 'landing_action_experience',
      candidates: ['do', 'pt']
    })
    expect(api.spotlight.startServer).not.toHaveBeenCalled()
    expect(api.spotlight.prepareServerLaunch).not.toHaveBeenCalled()
  })

  it('asks among every variant, at most six, when the branch touched none', async () => {
    api.repos.detectSpotlightServerScripts.mockResolvedValueOnce({
      detected: {},
      scriptCommands: [],
      variants: [...COUNTRIES, 'uy']
    })

    await activate()

    expect(lastPrompt().candidates).toEqual(COUNTRIES)
  })

  it('asks among every variant when inference fails', async () => {
    api.spotlight.inferServerVariant.mockRejectedValueOnce(new Error('ipc gone'))

    await activate()

    expect(lastPrompt().candidates).toEqual(COUNTRIES)
  })

  it('a pick remembers the variant and starts the server', async () => {
    await activate()

    lastPrompt().onPick('gb')

    await vi.waitFor(() =>
      expect(api.spotlight.startServer).toHaveBeenCalledWith({
        repoId: REPO,
        command: startedCommand('gb'),
        restartIfDifferent: true
      })
    )
    expect(spotlightTerminalTestStore.getState().spotlightVariantByTaskRepo).toEqual({
      'AX-3447::landing': 'gb'
    })
    expect(prompt.dismiss).toHaveBeenCalledWith(REPO)
  })

  it('a pick on a tab with no terminal yet queues the command for its spawn', async () => {
    seed({
      tabsByWorktree: {
        [MAIN.id]: [makeTestTab({ id: 'spot', worktreeId: MAIN.id, spotlightRepoRoot: true })]
      }
    })
    await activate()

    lastPrompt().onPick('ec')

    await vi.waitFor(() =>
      expect(spotlightTerminalTestStore.getState().pendingStartupByTabId).toEqual({
        spot: { command: startedCommand('ec') }
      })
    )
    expect(api.spotlight.startServer).not.toHaveBeenCalled()
  })

  it('a pick after the Spotlight moved on only remembers it', async () => {
    await activate()
    spotlightTerminalTestStore.setState({ spotlightByRepo: {} })

    await chooseSpotlightVariant({ repoId: REPO, worktreeId: TICKET.id, variant: 'es' })

    expect(spotlightTerminalTestStore.getState().spotlightVariantByTaskRepo).toEqual({
      'AX-3447::landing': 'es'
    })
    expect(api.spotlight.startServer).not.toHaveBeenCalled()
  })

  it('refuses an unsafe pick', async () => {
    await chooseSpotlightVariant({ repoId: REPO, worktreeId: TICKET.id, variant: 'do; rm -rf ~' })

    expect(spotlightTerminalTestStore.getState().spotlightVariantByTaskRepo).toEqual({})
    expect(api.spotlight.startServer).not.toHaveBeenCalled()
  })

  it('starts a command without {variant} directly, even in a repo with variants', async () => {
    seed({ repos: [{ id: REPO, spotlightServer: { local: 'pnpm dev:do' } }] })

    expect((await activate()).server).toEqual({ kind: 'started', command: 'pnpm dev:do' })
    expect(api.spotlight.inferServerVariant).not.toHaveBeenCalled()
    expect(prompt.show).not.toHaveBeenCalled()
  })

  it('starts nothing and asks nothing when no variant could ever fill the command', async () => {
    api.repos.detectSpotlightServerScripts.mockResolvedValueOnce({
      detected: {},
      scriptCommands: []
    })

    expect((await activate()).server).toEqual({ kind: 'none' })
    expect(prompt.show).not.toHaveBeenCalled()
    expect(api.spotlight.startServer).not.toHaveBeenCalled()
  })

  it('keeps a remembered variant when detection fails', async () => {
    seed({ spotlightVariantByTaskRepo: { 'AX-3447::landing': 'pt' } })
    api.repos.detectSpotlightServerScripts.mockRejectedValueOnce(new Error('ipc gone'))

    expect((await activate()).server).toEqual({
      kind: 'started',
      command: startedCommand('pt')
    })
  })

  it('an environment switch asks for the variant the new command needs', async () => {
    seed({
      repos: [{ id: REPO, spotlightServer: { local: 'pnpm dev:do', dev: 'pnpm dev:{variant}' } }],
      spotlightEnvByTaskKey: { 'AX-3447': 'dev' }
    })

    await applySpotlightEnvChange('AX-3447')

    expect(lastPrompt().candidates).toEqual(COUNTRIES)
    expect(api.spotlight.startServer).not.toHaveBeenCalled()
  })

  it('an environment switch uses the task variant without asking', async () => {
    seed({
      spotlightEnvByTaskKey: { 'AX-3447': 'dev' },
      spotlightVariantByTaskRepo: { 'AX-3447::landing': 'br' }
    })

    await applySpotlightEnvChange('AX-3447')

    expect(api.spotlight.startServer).toHaveBeenCalledWith({
      repoId: REPO,
      command: 'pnpm dev:br --port 3001',
      restartIfDifferent: true
    })
    expect(prompt.show).not.toHaveBeenCalled()
  })
})
