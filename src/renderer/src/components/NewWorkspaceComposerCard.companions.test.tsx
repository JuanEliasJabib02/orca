// @vitest-environment happy-dom

import React, { act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Repo } from '../../../shared/repo-types'
import type { ComposerCompanionRepos } from './new-workspace/use-composer-companion-repos'
import { renderCard } from './NewWorkspaceComposerCard.test-fixture'

vi.mock('@/store', () => ({
  useAppStore: Object.assign(
    (selector: (state: unknown) => unknown) =>
      selector({
        closeModal: vi.fn(),
        openModal: vi.fn(),
        activeModal: 'new-workspace-composer',
        settings: { defaultTuiAgent: null, disabledTuiAgents: [] },
        updateSettings: vi.fn(),
        projects: [],
        repos: []
      }),
    { getState: () => ({}) }
  )
}))

vi.mock('@/components/contextual-tours/use-contextual-tour', () => ({
  useContextualTour: vi.fn()
}))

vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>
}))

vi.mock('@/components/agent/AgentCombobox', () => ({
  default: () => <button type="button">Agent picker</button>
}))

vi.mock('@/components/sidebar/AddRemoteHostDialog', () => ({
  AddRemoteHostDialog: () => null
}))

vi.mock('@/components/new-workspace/SmartWorkspaceNameField', () => ({
  default: () => <input aria-label="workspace name" />
}))

vi.mock('@/components/new-workspace/ProjectCombobox', () => ({
  default: () => <div data-testid="project-combobox" />
}))

function repo(id: string): Repo {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the row renders only id, name and badge color.
  return {
    id,
    path: `/work/${id}`,
    displayName: id,
    badgeColor: '#111',
    addedAt: 0
  } as Repo
}

function companions(overrides: Partial<ComposerCompanionRepos> = {}): ComposerCompanionRepos {
  return {
    candidates: [repo('backend'), repo('admin')],
    selectedIds: [],
    toggle: vi.fn(),
    grantAgentAccess: true,
    setGrantAgentAccess: vi.fn(),
    ...overrides
  }
}

function chip(container: HTMLElement, name: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
    (node) => node.hasAttribute('aria-pressed') && node.textContent?.includes(name)
  )
  if (!button) {
    throw new Error(`chip not found for ${name}`)
  }
  return button
}

function accessCheckbox(container: HTMLElement): HTMLElement | null {
  return container.querySelector('[role="checkbox"]')
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('NewWorkspaceComposerCard "Also create in" row', () => {
  it('stays hidden unless the composer passes companions', async () => {
    const container = await renderCard()
    expect(container.textContent).not.toContain('Also create in')
  })

  it('renders a toggle chip per companion and reports clicks', async () => {
    const model = companions({ selectedIds: ['admin'] })
    const container = await renderCard({ companionRepos: model })

    expect(container.textContent).toContain('Also create in')
    expect(chip(container, 'backend').getAttribute('aria-pressed')).toBe('false')
    expect(chip(container, 'admin').getAttribute('aria-pressed')).toBe('true')
    act(() => {
      chip(container, 'backend').click()
    })
    expect(model.toggle).toHaveBeenCalledWith('backend')
  })

  it('offers agent access only with a selection and an agent that takes --add-dir', async () => {
    const none = await renderCard({ companionRepos: companions(), quickAgent: 'claude' })
    expect(accessCheckbox(none)).toBeNull()

    const gemini = await renderCard({
      companionRepos: companions({ selectedIds: ['backend'] }),
      quickAgent: 'gemini'
    })
    expect(accessCheckbox(gemini)).toBeNull()

    const model = companions({ selectedIds: ['backend'] })
    const codex = await renderCard({ companionRepos: model, quickAgent: 'codex' })
    const checkbox = accessCheckbox(codex)
    expect(checkbox?.getAttribute('aria-checked')).toBe('true')
    expect(codex.textContent).toContain('Give the agent access to these worktrees')
    act(() => {
      checkbox?.click()
    })
    expect(model.setGrantAgentAccess).toHaveBeenCalledWith(false)
  })

  it('renders nothing when no companion is available', async () => {
    const container = await renderCard({
      companionRepos: companions({ candidates: [] })
    })
    expect(container.textContent).not.toContain('Also create in')
  })
})
