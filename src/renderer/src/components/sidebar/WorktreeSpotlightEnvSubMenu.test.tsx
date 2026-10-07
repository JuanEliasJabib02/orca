// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '@/store'
import type { AppState } from '@/store/types'
import { MAX_TASK_KEY_LENGTH } from '@/store/slices/ui/ui-slice-task-key-record'
import type { Worktree } from '../../../../shared/worktree/types'
import { makeTaskWorktree } from './worktree-list/rows/task-spotlight-test-fixtures'
import { WorktreeSpotlightEnvSubMenu } from './WorktreeSpotlightEnvSubMenu'

const applySpotlightEnvChange = vi.hoisted(() => vi.fn(async (_envKey: string) => {}))

vi.mock('@/lib/spotlight-server-autostart', () => ({ applySpotlightEnvChange }))
vi.mock('@/components/ui/dropdown-menu', async () => {
  const { inlineDropdownMenu } = await import('./inline-dropdown-menu-fixture')
  return inlineDropdownMenu
})
vi.mock('lucide-react', async () =>
  (await import('../tab-bar/lucide-icon-stub-fixture')).stubEveryIcon()
)

const initialState = useAppStore.getInitialState()
const roots: Root[] = []
const uiSet = vi.fn(() => Promise.resolve())

const BACKEND_TASK = makeTaskWorktree('be-1', 'backend', { branch: 'refs/heads/juan/AX-3448-api' })
const ADMIN_TASK = makeTaskWorktree('ad-1', 'admin', { branch: 'refs/heads/juan/AX-3448-ui' })
const ADMIN_LONE = makeTaskWorktree('ad-lone', 'admin', { branch: 'refs/heads/lone-fix' })

function seedStore(overrides: Partial<AppState> = {}): void {
  useAppStore.setState({
    worktreesByRepo: { backend: [BACKEND_TASK], admin: [ADMIN_TASK, ADMIN_LONE] },
    ...overrides
  })
}

async function render(worktree: Worktree, disabled = false): Promise<HTMLElement> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  await act(async () => {
    root.render(<WorktreeSpotlightEnvSubMenu worktree={worktree} disabled={disabled} />)
  })
  return container
}

function getOption(container: HTMLElement, value: string): HTMLButtonElement | null {
  return container.querySelector<HTMLButtonElement>(`[data-menu-radio][data-value="${value}"]`)
}

function checkedOptions(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('[data-menu-radio][aria-checked="true"]')).map(
    (option) => option.textContent ?? ''
  )
}

describe('WorktreeSpotlightEnvSubMenu', () => {
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

  it('is titled "Spotlight environment" and offers Local, Dev and Prod', async () => {
    seedStore()

    const container = await render(ADMIN_TASK)

    expect(container.querySelector('[data-sub-trigger]')?.textContent).toBe('Spotlight environment')
    expect(
      Array.from(container.querySelectorAll('[data-menu-radio]')).map(
        (option) => option.textContent
      )
    ).toEqual(['Local', 'Dev', 'Prod'])
  })

  it('disables the trigger while the workspace is being deleted', async () => {
    seedStore()

    const container = await render(ADMIN_TASK, true)

    expect(container.querySelector('[data-sub-trigger]')?.hasAttribute('data-disabled')).toBe(true)
  })

  it('checks Local by default', async () => {
    seedStore()

    expect(checkedOptions(await render(ADMIN_TASK))).toEqual(['Local'])
  })

  it('checks the environment saved for the workspace task', async () => {
    seedStore({ spotlightEnvByTaskKey: { 'AX-3448': 'dev' } })

    expect(checkedOptions(await render(ADMIN_TASK))).toEqual(['Dev'])
    expect(checkedOptions(await render(BACKEND_TASK))).toEqual(['Dev'])
  })

  it('in a task, sets the environment of the whole task so siblings follow', async () => {
    seedStore()
    const container = await render(ADMIN_TASK)

    await act(async () => {
      getOption(container, 'dev')?.click()
    })

    expect(useAppStore.getState().spotlightEnvByTaskKey).toEqual({ 'AX-3448': 'dev' })
    expect(applySpotlightEnvChange).toHaveBeenCalledTimes(1)
    expect(applySpotlightEnvChange).toHaveBeenCalledWith('AX-3448')
    expect(checkedOptions(container)).toEqual(['Dev'])
  })

  it('without a task, sets the environment of the workspace itself', async () => {
    seedStore({ spotlightEnvByTaskKey: { 'AX-3448': 'prod' } })
    const container = await render(ADMIN_LONE)

    expect(checkedOptions(container)).toEqual(['Local'])
    await act(async () => {
      getOption(container, 'dev')?.click()
    })

    expect(useAppStore.getState().spotlightEnvByTaskKey).toEqual({
      'AX-3448': 'prod',
      'ad-lone': 'dev'
    })
    expect(applySpotlightEnvChange).toHaveBeenCalledWith('ad-lone')
  })

  it('does nothing when the current environment is picked again', async () => {
    seedStore()
    const container = await render(ADMIN_TASK)

    await act(async () => {
      getOption(container, 'local')?.click()
    })

    expect(applySpotlightEnvChange).not.toHaveBeenCalled()
    expect(uiSet).not.toHaveBeenCalled()
  })

  it('renders nothing for a workspace id too long to store as a key', async () => {
    const long = makeTaskWorktree('x'.repeat(MAX_TASK_KEY_LENGTH + 1), 'admin', {
      branch: 'refs/heads/lone-fix'
    })
    seedStore({ worktreesByRepo: { admin: [long] } })

    const container = await render(long)

    expect(container.querySelector('[data-sub-trigger]')).toBeNull()
  })
})
