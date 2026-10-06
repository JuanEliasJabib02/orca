// @vitest-environment happy-dom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NewWorkspaceProjectOption } from '@/lib/new-workspace-project-options'
import ProjectCombobox from './ProjectCombobox'

// Render the popover inline so assertions can reach the list without a portal.
vi.mock('@/components/ui/popover', () => ({
  Popover: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PopoverAnchor: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  PopoverContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>
}))

vi.mock('./use-recent-project-ids', () => ({ useRecentProjectIds: () => ['ops'] }))

let container: HTMLDivElement
let root: Root

function project(name: string): NewWorkspaceProjectOption {
  return {
    kind: 'project',
    id: name,
    projectId: name,
    displayName: name,
    badgeColor: '#111111',
    detail: `org/${name}`
  }
}

const options = [
  'backend',
  'admin',
  'reset',
  'experience',
  'docs',
  'infra',
  'ops',
  'blog',
  'billing'
].map(project)
const outOfSpace = new Set(['ops', 'blog', 'billing'])

function field(): HTMLInputElement {
  const node = container.querySelector<HTMLInputElement>('input[role="combobox"]')
  if (!node) {
    throw new Error('project combobox field not found')
  }
  return node
}

function openList(): void {
  act(() => {
    field().focus()
  })
}

function type(value: string): void {
  const input = field()
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
    setter?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

function groups(): { label: string | null; rows: string[] }[] {
  return Array.from(container.querySelectorAll<HTMLElement>('[role="group"]')).map((group) => ({
    label: group.getAttribute('aria-label'),
    rows: Array.from(group.querySelectorAll<HTMLElement>('[role="option"]')).map(
      (row) => row.textContent?.replace(/org\/.*$/, '') ?? ''
    )
  }))
}

function render(outOfSpaceOptionIds: ReadonlySet<string> | null, onValueChange = vi.fn()): void {
  act(() => {
    root.render(
      <ProjectCombobox
        options={options}
        value={null}
        onValueChange={onValueChange}
        outOfSpaceOptionIds={outOfSpaceOptionIds}
      />
    )
  })
}

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => {
    root.unmount()
  })
  container.remove()
})

describe('ProjectCombobox space sections', () => {
  it('lists only the active space when the field is empty', () => {
    render(outOfSpace)
    openList()

    const rendered = groups()
    expect(rendered.map((group) => group.label)).toEqual(['Projects'])
    expect(rendered.flatMap((group) => group.rows)).not.toContain('ops')
    expect(rendered.flatMap((group) => group.rows)).not.toContain('blog')
    expect(rendered.flatMap((group) => group.rows)).toHaveLength(6)
  })

  it('adds an "Other spaces" section last while searching', () => {
    render(outOfSpace)
    openList()
    type('b')

    const rendered = groups()
    expect(rendered.at(-1)).toEqual({ label: 'Other spaces', rows: ['blog', 'billing'] })
    expect(rendered[0]?.rows).toEqual(['backend'])
  })

  it('commits a project picked from another space', () => {
    const onValueChange = vi.fn()
    render(outOfSpace, onValueChange)
    openList()
    type('blo')

    const row = Array.from(container.querySelectorAll<HTMLElement>('[role="option"]')).find(
      (node) => node.textContent?.startsWith('blog')
    )
    act(() => {
      row?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(onValueChange).toHaveBeenCalledWith('blog')
  })

  it('arms the first in-space row, not an other-space match, for Enter', () => {
    const onValueChange = vi.fn()
    render(outOfSpace, onValueChange)
    openList()
    type('b')
    act(() => {
      field().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    expect(onValueChange).toHaveBeenCalledWith('backend')
  })

  it('keeps the unscoped list when no space narrows it', () => {
    render(null)
    openList()

    const rendered = groups()
    expect(rendered.map((group) => group.label)).toEqual(['Recent', 'Projects'])
    expect(rendered.flatMap((group) => group.rows)).toHaveLength(options.length)
  })
})
