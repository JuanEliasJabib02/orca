// @vitest-environment happy-dom
import { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GlobalSettings } from '../../../../../shared/global-settings-types'
import { createGlobalSettingsFixture } from '../../../../../shared/global-settings-test-fixture'
import { SpotlightTestQueueSettings } from './SpotlightTestQueueSettings'

vi.mock('../section-layout/SearchableSetting', () => ({
  SearchableSetting: ({ children }: { children: React.ReactNode }) => children
}))
afterEach(cleanup)

function mount(): ReturnType<typeof vi.fn> {
  const persist = vi.fn()
  function Harness(): React.JSX.Element {
    const [settings, setSettings] = useState<GlobalSettings>(() => createGlobalSettingsFixture())
    return (
      <SpotlightTestQueueSettings
        settings={settings}
        updateSettings={(patch) => {
          persist(patch)
          setSettings((previous) => ({ ...previous, ...patch }))
        }}
      />
    )
  }
  render(<Harness />)
  return persist
}

describe('Spotlight test queue settings', () => {
  it('lets two tasks test at once and keeps the count between 1 and 4', () => {
    const persist = mount()
    const count = screen.getByRole('spinbutton', { name: 'Tasks Testing at Once' })
    expect((count as HTMLInputElement).value).toBe('2')

    fireEvent.change(count, { target: { value: '9' } })
    expect(persist).toHaveBeenLastCalledWith({ spotlightMaxConcurrentTests: 4 })
    fireEvent.click(screen.getByRole('button', { name: 'One more task' }))
    expect(persist).toHaveBeenLastCalledWith({ spotlightMaxConcurrentTests: 4 })

    fireEvent.change(count, { target: { value: '0' } })
    expect(persist).toHaveBeenLastCalledWith({ spotlightMaxConcurrentTests: 1 })
    fireEvent.click(screen.getByRole('button', { name: 'One fewer task' }))
    expect(persist).toHaveBeenLastCalledWith({ spotlightMaxConcurrentTests: 1 })

    fireEvent.click(screen.getByRole('button', { name: 'One more task' }))
    expect(persist).toHaveBeenLastCalledWith({ spotlightMaxConcurrentTests: 2 })
  })

  it('keeps resuming after a usage limit off until it is switched on', () => {
    const persist = mount()
    const toggle = screen.getByRole('switch', { name: 'Resume After a Usage Limit' })
    expect(toggle.getAttribute('aria-checked')).toBe('false')

    fireEvent.click(toggle)
    expect(persist).toHaveBeenLastCalledWith({ spotlightAutoResumeAfterUsageLimit: true })
    expect(toggle.getAttribute('aria-checked')).toBe('true')
  })
})
