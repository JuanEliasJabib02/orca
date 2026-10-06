// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useAppStore } from '@/store'
import type { AppState } from '@/store/types'
import type { SpotlightOpResult } from '../../../../../../shared/spotlight'
import type { TaskSectionInfo } from '../grouping/row-types'
import { TaskSpotlightButton } from './TaskSpotlightButton'
import {
  OP_OK,
  holdersByRepo,
  makeSpotlightRepo,
  makeTaskWorktree
} from './task-spotlight-test-fixtures'

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() }
}))

const initialState = useAppStore.getInitialState()
const roots: Root[] = []

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

async function render(task: TaskSectionInfo = TASK, onParentClick = vi.fn()): Promise<HTMLElement> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  await act(async () => {
    root.render(
      <TooltipProvider>
        {/* Stands in for the header row, whose click collapses the section. */}
        <div onClick={onParentClick}>
          <TaskSpotlightButton task={task} />
        </div>
      </TooltipProvider>
    )
  })
  return container
}

function getButton(container: HTMLElement): HTMLButtonElement | null {
  return container.querySelector<HTMLButtonElement>('[data-task-spotlight-button]')
}

describe('TaskSpotlightButton', () => {
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    vi.clearAllMocks()
    useAppStore.setState(initialState, true)
  })

  afterEach(async () => {
    for (const root of roots.splice(0)) {
      await act(async () => root.unmount())
    }
    document.body.innerHTML = ''
    useAppStore.setState(initialState, true)
  })

  it('is hidden for the "No task" section', async () => {
    seedStore()

    const container = await render({ ...TASK, taskKey: null })

    expect(getButton(container)).toBeNull()
  })

  it('is hidden when no project of the task can hold Spotlight', async () => {
    seedStore({
      repos: [makeSpotlightRepo('legacy', { spotlightTestingEnabled: false })],
      worktreesByRepo: { legacy: [makeTaskWorktree('lg-1', 'legacy')] }
    })

    const container = await render()

    expect(getButton(container)).toBeNull()
  })

  it('shows an unlit button that offers to spotlight the task', async () => {
    seedStore()

    const button = getButton(await render())

    expect(button).not.toBeNull()
    expect(button?.getAttribute('aria-pressed')).toBe('false')
    expect(button?.disabled).toBe(false)
    expect(button?.getAttribute('aria-label')).toContain('Spotlight this task')
  })

  it('names the projects it skips because their Spotlight is off', async () => {
    seedStore()

    const label = getButton(await render())?.getAttribute('aria-label')

    expect(label).toContain('Skipped, Spotlight is off for: legacy')
  })

  it('lights up once every eligible project holds a worktree of the task', async () => {
    seedStore({ spotlightByRepo: holdersByRepo({ backend: 'be-1', admin: 'ad-1' }) })

    const button = getButton(await render())

    expect(button?.getAttribute('aria-pressed')).toBe('true')
    expect(button?.getAttribute('aria-label')).toContain('Click to turn it off')
  })

  it('stays unlit while one eligible project is not holding it', async () => {
    seedStore({ spotlightByRepo: holdersByRepo({ backend: 'be-1' }) })

    const button = getButton(await render())

    expect(button?.getAttribute('aria-pressed')).toBe('false')
  })

  it('updates when Spotlight state changes under it', async () => {
    seedStore()
    const container = await render()

    await act(async () => {
      useAppStore.setState({ spotlightByRepo: holdersByRepo({ backend: 'be-1', admin: 'ad-1' }) })
    })

    expect(getButton(container)?.getAttribute('aria-pressed')).toBe('true')
  })

  it('activates every eligible project quietly, disables itself meanwhile and summarizes once', async () => {
    let finishFirst: (result: SpotlightOpResult) => void = () => {}
    const activateSpotlight = vi
      .fn<
        (
          repoId: string,
          worktreeId: string,
          opts?: { quiet?: boolean }
        ) => Promise<SpotlightOpResult>
      >()
      .mockImplementationOnce(
        () =>
          new Promise<SpotlightOpResult>((resolve) => {
            finishFirst = resolve
          })
      )
      .mockResolvedValue(OP_OK)
    seedStore({ activateSpotlight })
    const onParentClick = vi.fn()
    const container = await render(TASK, onParentClick)

    await act(async () => {
      getButton(container)?.click()
    })

    expect(getButton(container)?.disabled).toBe(true)
    expect(getButton(container)?.getAttribute('aria-label')).toContain('Updating Spotlight')
    expect(activateSpotlight).toHaveBeenCalledTimes(1)
    expect(activateSpotlight).toHaveBeenCalledWith('backend', 'be-1', { quiet: true })

    await act(async () => {
      finishFirst(OP_OK)
    })

    expect(activateSpotlight).toHaveBeenCalledTimes(2)
    expect(activateSpotlight).toHaveBeenLastCalledWith('admin', 'ad-1', { quiet: true })
    expect(getButton(container)?.disabled).toBe(false)
    expect(toast.success).toHaveBeenCalledTimes(1)
    expect(toast.success).toHaveBeenCalledWith('Spotlight on for AX-3448')
    expect(onParentClick).not.toHaveBeenCalled()
  })

  it('turns the task off in every holding project when lit', async () => {
    const deactivateSpotlight = vi.fn().mockResolvedValue(OP_OK)
    const activateSpotlight = vi.fn().mockResolvedValue(OP_OK)
    seedStore({
      spotlightByRepo: holdersByRepo({ backend: 'be-1', admin: 'ad-1' }),
      activateSpotlight,
      deactivateSpotlight
    })
    const container = await render()

    await act(async () => {
      getButton(container)?.click()
    })

    expect(activateSpotlight).not.toHaveBeenCalled()
    expect(deactivateSpotlight.mock.calls).toEqual([
      ['backend', { quiet: true }],
      ['admin', { quiet: true }]
    ])
    expect(toast.success).toHaveBeenCalledWith('Spotlight off for AX-3448')
  })
})
