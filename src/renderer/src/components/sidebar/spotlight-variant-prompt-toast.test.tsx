// @vitest-environment happy-dom

import { act, isValidElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import {
  dismissSpotlightVariantPrompt,
  showSpotlightVariantPrompt
} from './spotlight-variant-prompt-toast'

vi.mock('sonner', () => ({
  toast: {
    info: vi.fn(),
    dismiss: vi.fn()
  }
}))

const mountedRoots: Root[] = []

function renderToastBody(): HTMLElement {
  const description = vi.mocked(toast.info).mock.calls.at(-1)?.[1]?.description
  if (!isValidElement(description)) {
    throw new Error('the prompt has no body')
  }
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  mountedRoots.push(root)
  act(() => {
    root.render(description)
  })
  return container
}

afterEach(() => {
  mountedRoots.splice(0).forEach((root) => act(() => root.unmount()))
  document.body.innerHTML = ''
  vi.clearAllMocks()
})

describe('showSpotlightVariantPrompt', () => {
  it('names the project and stays until answered, one prompt per repo', () => {
    showSpotlightVariantPrompt({
      repoId: 'landing',
      projectName: 'landing_action_experience',
      candidates: ['do', 'pt'],
      onPick: vi.fn()
    })

    expect(toast.info).toHaveBeenCalledWith(
      'Pick a variant for landing_action_experience',
      expect.objectContaining({ id: 'spotlight-variant:landing', duration: Infinity })
    )
  })

  it('offers one button per candidate', () => {
    showSpotlightVariantPrompt({
      repoId: 'landing',
      projectName: 'landing',
      candidates: ['br', 'do', 'pt'],
      onPick: vi.fn()
    })

    const buttons = [...renderToastBody().querySelectorAll('[data-spotlight-variant-choice]')]
    expect(buttons.map((button) => button.textContent)).toEqual(['BR', 'DO', 'PT'])
  })

  it('a click dismisses the prompt and hands over the variant', () => {
    const onPick = vi.fn()
    showSpotlightVariantPrompt({
      repoId: 'landing',
      projectName: 'landing',
      candidates: ['do', 'pt'],
      onPick
    })

    const body = renderToastBody()
    act(() => {
      body.querySelector<HTMLButtonElement>('[data-spotlight-variant-choice="pt"]')?.click()
    })

    expect(onPick).toHaveBeenCalledWith('pt')
    expect(toast.dismiss).toHaveBeenCalledWith('spotlight-variant:landing')
  })

  it('can be dismissed from elsewhere', () => {
    dismissSpotlightVariantPrompt('landing')

    expect(toast.dismiss).toHaveBeenCalledWith('spotlight-variant:landing')
  })
})
