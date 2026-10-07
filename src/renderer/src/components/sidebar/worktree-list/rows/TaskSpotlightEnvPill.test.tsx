// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '@/store'
import type { AppState } from '@/store/types'
import type { TaskSectionInfo } from '../grouping/row-types'
import { TaskSpotlightEnvPill } from './TaskSpotlightEnvPill'
import { holdersByRepo, makeSpotlightRepo, makeTaskWorktree } from './task-spotlight-test-fixtures'

const applySpotlightEnvChange = vi.hoisted(() => vi.fn(async (_envKey: string) => {}))

vi.mock('@/lib/spotlight-server-autostart', () => ({ applySpotlightEnvChange }))
vi.mock('@/components/ui/dropdown-menu', async () => {
  const { inlineDropdownMenu } = await import('../../inline-dropdown-menu-fixture')
  return inlineDropdownMenu
})

const initialState = useAppStore.getInitialState()
const roots: Root[] = []
const uiSet = vi.fn(() => Promise.resolve())

const TASK: TaskSectionInfo = {
  taskKey: 'AX-3448',
  title: null,
  worktrees: [
    { worktreeId: 'be-1', repoId: 'backend' },
    { worktreeId: 'ad-1', repoId: 'admin' },
    { worktreeId: 'lg-1', repoId: 'legacy' }
  ],
  folderWorkspaceIds: []
}

function seedStore(overrides: Partial<AppState> = {}): void {
  useAppStore.setState({
    repos: [
      makeSpotlightRepo('backend'),
      makeSpotlightRepo('admin'),
      makeSpotlightRepo('legacy', { spotlightTestingEnabled: false })
    ],
    worktreesByRepo: {
      backend: [makeTaskWorktree('be-1', 'backend')],
      admin: [makeTaskWorktree('ad-1', 'admin')],
      legacy: [makeTaskWorktree('lg-1', 'legacy')]
    },
    spotlightByRepo: {},
    ...overrides
  })
}

type Handlers = { onClick: () => void; onPointerDown: () => void }

async function render(
  task: TaskSectionInfo = TASK,
  header: Handlers = makeHandlers()
): Promise<HTMLElement> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  await act(async () => {
    // Stands in for the header row, whose click collapses the section and whose pointerdown arms a drag.
    root.render(
      <div onClick={header.onClick} onPointerDown={header.onPointerDown}>
        <TaskSpotlightEnvPill task={task} />
      </div>
    )
  })
  return container
}

function makeHandlers(): Handlers {
  return { onClick: vi.fn(), onPointerDown: vi.fn() }
}

function getPill(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>('[data-task-spotlight-env]')
}

function getTrigger(container: HTMLElement): HTMLButtonElement | null {
  return container.querySelector<HTMLButtonElement>('[data-task-spotlight-env-trigger]')
}

function getOption(container: HTMLElement, value: string): HTMLButtonElement | null {
  return container.querySelector<HTMLButtonElement>(`[data-menu-radio][data-value="${value}"]`)
}

/** Hover-only while collapsed: zero width and transparent until the header is hovered. */
function isHoverOnly(pill: HTMLElement | null): boolean {
  return (
    pill?.classList.contains('can-hover:max-w-0') === true &&
    pill.classList.contains('can-hover:opacity-0')
  )
}

describe('TaskSpotlightEnvPill', () => {
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    vi.clearAllMocks()
    vi.stubGlobal('api', { ui: { set: uiSet } })
    useAppStore.setState(initialState, true)
  })

  afterEach(async () => {
    for (const root of roots.splice(0)) {
      await act(async () => root.unmount())
    }
    document.body.innerHTML = ''
    vi.unstubAllGlobals()
    useAppStore.setState(initialState, true)
  })

  it('renders nothing for the "No task" section', async () => {
    seedStore()

    expect(getPill(await render({ ...TASK, taskKey: null }))).toBeNull()
  })

  it('renders nothing when no project of the task can hold Spotlight', async () => {
    seedStore({
      repos: [makeSpotlightRepo('legacy', { spotlightTestingEnabled: false })],
      worktreesByRepo: { legacy: [makeTaskWorktree('lg-1', 'legacy')] }
    })

    expect(getPill(await render())).toBeNull()
  })

  it('shows Local by default and names the task in its accessible label', async () => {
    seedStore()

    const trigger = getTrigger(await render())

    expect(trigger?.textContent).toBe('Local')
    expect(trigger?.getAttribute('aria-label')).toBe('Spotlight environment for AX-3448: Local')
  })

  it('shows the environment saved for the task', async () => {
    seedStore({ spotlightEnvByTaskKey: { 'AX-3448': 'prod', 'AX-1': 'dev' } })

    expect(getTrigger(await render())?.textContent).toBe('Prod')
  })

  it('is hover-only while on Local with no Spotlight held', async () => {
    seedStore()

    expect(isHoverOnly(getPill(await render()))).toBe(true)
  })

  it('stays visible while any member holds a Spotlight', async () => {
    seedStore({ spotlightByRepo: holdersByRepo({ backend: 'be-1' }) })

    expect(isHoverOnly(getPill(await render()))).toBe(false)
  })

  it('stays visible when the environment is not Local', async () => {
    seedStore({ spotlightEnvByTaskKey: { 'AX-3448': 'dev' } })

    expect(isHoverOnly(getPill(await render()))).toBe(false)
  })

  it('ignores a Spotlight held by a workspace outside the task', async () => {
    seedStore({
      worktreesByRepo: {
        backend: [makeTaskWorktree('be-1', 'backend'), makeTaskWorktree('be-2', 'backend')],
        admin: [makeTaskWorktree('ad-1', 'admin')],
        legacy: [makeTaskWorktree('lg-1', 'legacy')]
      },
      spotlightByRepo: holdersByRepo({ backend: 'be-2' })
    })

    expect(isHoverOnly(getPill(await render()))).toBe(true)
  })

  it('reveals itself when a Spotlight turns on under it', async () => {
    seedStore()
    const container = await render()

    await act(async () => {
      useAppStore.setState({ spotlightByRepo: holdersByRepo({ admin: 'ad-1' }) })
    })

    expect(isHoverOnly(getPill(container))).toBe(false)
  })

  it('offers Local, Dev and Prod with the current one checked', async () => {
    seedStore({ spotlightEnvByTaskKey: { 'AX-3448': 'dev' } })
    const container = await render()

    const options = Array.from(container.querySelectorAll('[data-menu-radio]')).map((option) => [
      option.textContent,
      option.getAttribute('aria-checked')
    ])

    expect(options).toEqual([
      ['Local', 'false'],
      ['Dev', 'true'],
      ['Prod', 'false']
    ])
  })

  it('saves the chosen environment under the task key, then applies it', async () => {
    seedStore()
    const container = await render()

    await act(async () => {
      getOption(container, 'dev')?.click()
    })

    expect(useAppStore.getState().spotlightEnvByTaskKey).toEqual({ 'AX-3448': 'dev' })
    expect(applySpotlightEnvChange).toHaveBeenCalledTimes(1)
    expect(applySpotlightEnvChange).toHaveBeenCalledWith('AX-3448')
    expect(getTrigger(container)?.textContent).toBe('Dev')
  })

  it('going back to Local clears the saved environment and applies it', async () => {
    seedStore({ spotlightEnvByTaskKey: { 'AX-3448': 'dev' } })
    const container = await render()

    await act(async () => {
      getOption(container, 'local')?.click()
    })

    expect(useAppStore.getState().spotlightEnvByTaskKey).toEqual({})
    expect(applySpotlightEnvChange).toHaveBeenCalledWith('AX-3448')
  })

  it('does not restart anything when the current environment is picked again', async () => {
    seedStore({ spotlightEnvByTaskKey: { 'AX-3448': 'dev' } })
    const container = await render()

    await act(async () => {
      getOption(container, 'dev')?.click()
    })

    expect(applySpotlightEnvChange).not.toHaveBeenCalled()
  })

  it('does not collapse the section or arm a drag from the trigger or the menu', async () => {
    seedStore()
    const header = makeHandlers()
    const container = await render(TASK, header)

    await act(async () => {
      getTrigger(container)?.click()
      getTrigger(container)?.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
      getOption(container, 'dev')?.click()
      getOption(container, 'dev')?.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
    })

    expect(header.onClick).not.toHaveBeenCalled()
    expect(header.onPointerDown).not.toHaveBeenCalled()
  })

  it('is marked as a header action so a click beside it does not toggle the section', async () => {
    seedStore()

    expect(getPill(await render())?.hasAttribute('data-repo-header-action')).toBe(true)
  })
})
