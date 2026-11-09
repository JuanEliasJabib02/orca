// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SidebarGroupByToggle } from './SidebarGroupByToggle'
import type { WorktreeGroupBy } from '../../../../../../shared/sidebar-list/row-types'

// Orca Pro Max: Group by → Task is a fork-only mode, so its toggle cases live in this fork-owned file.

const roots: Root[] = []

async function renderGroupByToggle(args: {
  groupBy: WorktreeGroupBy
  setGroupBy: (groupBy: WorktreeGroupBy) => void
}): Promise<HTMLDivElement> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)

  await act(async () => {
    root.render(<SidebarGroupByToggle groupBy={args.groupBy} setGroupBy={args.setGroupBy} />)
  })

  return container
}

describe('SidebarGroupByToggle task mode', () => {
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
  })

  afterEach(() => {
    roots.splice(0).forEach((root) => {
      act(() => root.unmount())
    })
    document.body.replaceChildren()
    vi.clearAllMocks()
  })

  it('offers Task after the existing modes and commits it', async () => {
    const setGroupBy = vi.fn()
    const container = await renderGroupByToggle({ groupBy: 'repo', setGroupBy })
    const buttons = [...container.querySelectorAll('button')]

    expect(buttons.map((button) => button.textContent)).toEqual([
      'None',
      'Status',
      'PR',
      'Project',
      'Task'
    ])
    await act(async () => {
      buttons[4]?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    })

    expect(setGroupBy).toHaveBeenCalledWith('task')
  })
})
