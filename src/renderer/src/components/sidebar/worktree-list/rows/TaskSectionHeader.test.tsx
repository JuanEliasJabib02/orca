// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '@/store'
import type { TaskSectionInfo } from '../grouping/row-types'
import { TaskSectionHeader } from './TaskSectionHeader'
import { makeSpotlightRepo, makeTaskWorktree } from './task-spotlight-test-fixtures'

vi.mock('@/lib/spotlight-server-autostart', () => ({ applySpotlightEnvChange: vi.fn() }))
vi.mock('@/components/ui/dropdown-menu', async () => {
  const { inlineDropdownMenu } = await import('../../inline-dropdown-menu-fixture')
  return inlineDropdownMenu
})

const initialState = useAppStore.getInitialState()
const roots: Root[] = []

const TASK: TaskSectionInfo = {
  taskKey: 'AX-3448',
  title: null,
  worktrees: [{ worktreeId: 'ad-1', repoId: 'admin' }],
  folderWorkspaceIds: []
}

async function render(task: TaskSectionInfo, actions?: React.ReactNode): Promise<HTMLElement> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  await act(async () => {
    root.render(<TaskSectionHeader task={task} actions={actions} />)
  })
  return container
}

describe('TaskSectionHeader', () => {
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    vi.stubGlobal('api', { ui: { set: vi.fn(() => Promise.resolve()) } })
    useAppStore.setState(initialState, true)
    useAppStore.setState({
      repos: [makeSpotlightRepo('admin')],
      worktreesByRepo: { admin: [makeTaskWorktree('ad-1', 'admin')] }
    })
  })

  afterEach(async () => {
    for (const root of roots.splice(0)) {
      await act(async () => root.unmount())
    }
    document.body.innerHTML = ''
    vi.unstubAllGlobals()
    useAppStore.setState(initialState, true)
  })

  it('renders the environment pill after the actions of a keyed task', async () => {
    const container = await render(TASK, <span data-test-action="" />)

    const order = Array.from(container.children).map((child) =>
      child.hasAttribute('data-task-section-actions') ? 'actions' : 'pill'
    )

    expect(container.querySelector('[data-task-section-actions] [data-test-action]')).not.toBeNull()
    expect(container.querySelector('[data-task-spotlight-env]')).not.toBeNull()
    expect(order).toEqual(['actions', 'pill'])
  })

  it('renders no pill for the "No task" section', async () => {
    const container = await render({ ...TASK, taskKey: null })

    expect(container.querySelector('[data-task-spotlight-env]')).toBeNull()
  })
})
