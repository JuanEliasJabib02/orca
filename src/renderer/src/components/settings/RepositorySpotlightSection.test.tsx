// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Repo } from '../../../../shared/repo-types'
import type { SpotlightServerScriptDetection } from '../../../../shared/spotlight-server-types'
import { RepositorySpotlightSection } from './RepositorySpotlightSection'

vi.mock('@/store', () => ({
  useAppStore: (selector: (state: unknown) => unknown) =>
    selector({ settingsSearchQuery: '', spotlightByRepo: {}, deactivateSpotlight: vi.fn() })
}))

const REPO: Repo = {
  id: 'repo-1',
  path: '/work/landing',
  displayName: 'landing',
  badgeColor: '#000000',
  addedAt: 0,
  spotlightTestingEnabled: true
}

const DETECTION: SpotlightServerScriptDetection = {
  detected: { dev: 'pnpm dev', prod: 'pnpm prod' },
  scriptCommands: ['pnpm dev', 'pnpm dev:do', 'pnpm prod']
}

let detectSpotlightServerScripts: ReturnType<typeof vi.fn>

beforeEach(() => {
  detectSpotlightServerScripts = vi.fn(async () => DETECTION)
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: { repos: { detectSpotlightServerScripts } }
  })
})

afterEach(cleanup)

function renderSection(
  repoOverrides: Partial<Repo> = {},
  updateRepo = vi.fn()
): ReturnType<typeof vi.fn> {
  render(
    <RepositorySpotlightSection
      repo={{ ...REPO, ...repoOverrides }}
      updateRepo={updateRepo}
      forceVisible
    />
  )
  return updateRepo
}

function input(label: string): HTMLInputElement {
  const field = screen.getByLabelText(label)
  if (!(field instanceof HTMLInputElement)) {
    throw new Error(`${label} is not an input`)
  }
  return field
}

function edit(label: string, value: string): HTMLInputElement {
  const field = input(label)
  fireEvent.change(field, { target: { value } })
  return field
}

async function waitForDetection(): Promise<void> {
  await waitFor(() => expect(input('Dev').placeholder).not.toBe(''))
}

describe('RepositorySpotlightSection server fields', () => {
  it('hides the server fields while Spotlight is disabled', () => {
    renderSection({ spotlightTestingEnabled: false })

    expect(screen.queryByLabelText('Local')).toBeNull()
    expect(screen.queryByLabelText('Port')).toBeNull()
    expect(detectSpotlightServerScripts).not.toHaveBeenCalled()
  })

  it('shows the detected commands as placeholders, with Local falling back to Dev', async () => {
    renderSection()
    await waitForDetection()

    expect(detectSpotlightServerScripts).toHaveBeenCalledWith({ repoId: 'repo-1' })
    expect(input('Local').placeholder).toBe('pnpm dev')
    expect(input('Dev').placeholder).toBe('pnpm dev')
    expect(input('Prod').placeholder).toBe('pnpm prod')
  })

  it('says "Not started" for an environment with nothing to run', async () => {
    detectSpotlightServerScripts.mockResolvedValue({
      detected: { prod: 'pnpm prod' },
      scriptCommands: []
    })
    renderSection()

    await waitFor(() => expect(input('Prod').placeholder).toBe('pnpm prod'))
    expect(input('Local').placeholder).toBe('Not started')
    expect(input('Dev').placeholder).toBe('Not started')
  })

  it('falls back to "Not started" when detection fails', async () => {
    detectSpotlightServerScripts.mockRejectedValue(new Error('boom'))
    renderSection()

    await waitFor(() => expect(input('Dev').placeholder).toBe('Not started'))
  })

  it('offers the detected scripts as suggestions', async () => {
    renderSection()
    await waitForDetection()

    const listId = input('Dev').getAttribute('list')
    expect(listId).toBeTruthy()
    const options = Array.from(document.querySelectorAll(`datalist[id="${listId}"] option`))
    expect(options.map((option) => option.getAttribute('value'))).toEqual(DETECTION.scriptCommands)
  })

  it('builds each placeholder from the other saved commands, then the detected ones', async () => {
    renderSection({ spotlightServer: { dev: 'ax-dev-back' } })
    await waitFor(() => expect(input('Prod').placeholder).toBe('pnpm prod'))

    expect(input('Dev').value).toBe('ax-dev-back')
    expect(input('Dev').placeholder).toBe('pnpm dev')
    expect(input('Local').placeholder).toBe('ax-dev-back')
  })

  it('saves the full config when a command field loses focus', async () => {
    const updateRepo = renderSection({ spotlightServer: { dev: 'ax-dev-back', port: 3001 } })
    await waitForDetection()

    fireEvent.blur(edit('Prod', '  pnpm prod:do  '))

    expect(updateRepo).toHaveBeenCalledTimes(1)
    expect(updateRepo).toHaveBeenCalledWith('repo-1', {
      spotlightServer: { dev: 'ax-dev-back', prod: 'pnpm prod:do', port: 3001 }
    })
  })

  it('saves once when Enter is followed by blur', async () => {
    const updateRepo = renderSection()
    await waitForDetection()

    const field = edit('Dev', 'pnpm dev:do')
    fireEvent.keyDown(field, { key: 'Enter' })
    fireEvent.blur(field)

    expect(updateRepo).toHaveBeenCalledTimes(1)
    expect(updateRepo).toHaveBeenCalledWith('repo-1', { spotlightServer: { dev: 'pnpm dev:do' } })
  })

  it('does not save while typing or when nothing changed', async () => {
    const updateRepo = renderSection({ spotlightServer: { dev: 'ax-dev-back' } })
    await waitForDetection()

    edit('Prod', 'pnpm prod:do')
    fireEvent.blur(input('Dev'))
    fireEvent.blur(input('Port'))

    expect(updateRepo).not.toHaveBeenCalled()
  })

  it('clears a command back to the detected one by emptying its field', async () => {
    const updateRepo = renderSection({
      spotlightServer: { dev: 'ax-dev-back', prod: 'pnpm prod:do' }
    })
    await waitForDetection()

    fireEvent.blur(edit('Dev', ''))

    expect(updateRepo).toHaveBeenCalledWith('repo-1', { spotlightServer: { prod: 'pnpm prod:do' } })
  })

  it('saves a clear once every field is empty', async () => {
    const updateRepo = renderSection({ spotlightServer: { dev: 'ax-dev-back' } })
    await waitForDetection()

    fireEvent.blur(edit('Dev', ''))

    expect(updateRepo).toHaveBeenCalledWith('repo-1', { spotlightServer: null })
  })

  it('saves the port next to the commands', async () => {
    const updateRepo = renderSection({ spotlightServer: { dev: 'ax-dev-back' } })
    await waitForDetection()

    fireEvent.blur(edit('Port', '3004'))
    expect(updateRepo).toHaveBeenLastCalledWith('repo-1', {
      spotlightServer: { dev: 'ax-dev-back', port: 3004 }
    })
  })

  it('explains {variant} and lists the variants when the repo has them', async () => {
    detectSpotlightServerScripts.mockResolvedValue({
      detected: { dev: 'pnpm dev:{variant}', prod: 'pnpm prod:{variant}' },
      scriptCommands: ['pnpm dev:do', 'pnpm dev:pt'],
      variants: ['do', 'pt']
    })
    renderSection()

    await waitFor(() => expect(input('Dev').placeholder).toBe('pnpm dev:{variant}'))
    const help = document.querySelector('[data-spotlight-variant-help]')
    expect(help?.textContent).toContain('DO, PT')
    expect(help?.textContent).toContain('{variant}')
    expect(input('Local').placeholder).toBe('pnpm dev:{variant}')
    expect(input('Prod').placeholder).toBe('pnpm prod:{variant}')
  })

  it('says nothing about variants for a repo without them', async () => {
    renderSection()
    await waitForDetection()

    expect(document.querySelector('[data-spotlight-variant-help]')).toBeNull()
  })

  it('clears a saved port when the port field is emptied', async () => {
    const updateRepo = renderSection({ spotlightServer: { dev: 'ax-dev-back', port: 3004 } })
    await waitForDetection()

    expect(input('Port').value).toBe('3004')
    fireEvent.blur(edit('Port', ''))

    expect(updateRepo).toHaveBeenCalledWith('repo-1', { spotlightServer: { dev: 'ax-dev-back' } })
  })
})
