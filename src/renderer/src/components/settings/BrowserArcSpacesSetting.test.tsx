// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import type { ProjectGroup } from '../../../../shared/project-group-types'
import { BrowserArcSpacesSetting } from './BrowserArcSpacesSetting'
import { getBrowserPaneSearchEntries } from './browser-search'

function space(id: string, name: string, tabOrder: number, parentGroupId: string | null = null) {
  return {
    id,
    name,
    parentPath: null,
    parentGroupId,
    createdFrom: 'manual',
    tabOrder,
    isCollapsed: false,
    color: null,
    createdAt: 0,
    updatedAt: 0
  } satisfies ProjectGroup
}

const projectGroups: ProjectGroup[] = [
  space('ag', 'Arctic Grey', 2),
  space('action', 'Action Black', 0),
  space('personal', 'Personal', 1),
  space('ag-sub', 'Clients', 0, 'ag')
]

vi.mock('../../store', () => ({
  useAppStore: (
    selector: (state: { settingsSearchQuery: string; projectGroups: ProjectGroup[] }) => unknown
  ) => selector({ settingsSearchQuery: '', projectGroups })
}))

function renderSetting(
  settings: Pick<GlobalSettings, 'openLinksInArcSpaces' | 'arcSpaceNameBySidebarSpaceId'>,
  updateSettings: (updates: Partial<GlobalSettings>) => void = vi.fn()
): void {
  render(<BrowserArcSpacesSetting settings={settings} updateSettings={updateSettings} />)
}

describe('BrowserArcSpacesSetting', () => {
  afterEach(() => {
    cleanup()
  })

  it('stays off and hides the space fields for profiles that predate it', () => {
    renderSetting({})
    expect(
      screen.getByRole('switch', { name: 'Open Links in Arc Spaces' }).getAttribute('aria-checked')
    ).toBe('false')
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('turns the opt-in on', () => {
    const updateSettings = vi.fn()
    renderSetting({ openLinksInArcSpaces: false }, updateSettings)
    fireEvent.click(screen.getByRole('switch', { name: 'Open Links in Arc Spaces' }))
    expect(updateSettings).toHaveBeenCalledWith({ openLinksInArcSpaces: true })
  })

  it('lists one field per top-level space, in switcher order', () => {
    renderSetting({ openLinksInArcSpaces: true, arcSpaceNameBySidebarSpaceId: { ag: 'Bulbasour' } })
    const fields = screen.getAllByRole('textbox')
    expect(fields.map((field) => field.getAttribute('aria-label'))).toEqual([
      'Arc space for Action Black',
      'Arc space for Personal',
      'Arc space for Arctic Grey'
    ])
    expect(screen.getByRole('textbox', { name: 'Arc space for Arctic Grey' })).toHaveProperty(
      'value',
      'Bulbasour'
    )
  })

  it('saves a trimmed name on blur and drops a cleared one', () => {
    const updateSettings = vi.fn()
    renderSetting(
      { openLinksInArcSpaces: true, arcSpaceNameBySidebarSpaceId: { ag: 'Bulbasour' } },
      updateSettings
    )
    const action = screen.getByRole('textbox', { name: 'Arc space for Action Black' })
    fireEvent.change(action, { target: { value: '  Action ' } })
    fireEvent.blur(action)
    expect(updateSettings).toHaveBeenLastCalledWith({
      arcSpaceNameBySidebarSpaceId: { ag: 'Bulbasour', action: 'Action' }
    })

    const ag = screen.getByRole('textbox', { name: 'Arc space for Arctic Grey' })
    fireEvent.change(ag, { target: { value: ' ' } })
    fireEvent.blur(ag)
    expect(updateSettings).toHaveBeenLastCalledWith({ arcSpaceNameBySidebarSpaceId: {} })
  })

  it('does not write when the name did not change', () => {
    const updateSettings = vi.fn()
    renderSetting(
      { openLinksInArcSpaces: true, arcSpaceNameBySidebarSpaceId: { ag: 'Bulbasour' } },
      updateSettings
    )
    fireEvent.blur(screen.getByRole('textbox', { name: 'Arc space for Arctic Grey' }))
    expect(updateSettings).not.toHaveBeenCalled()
  })

  it('is searchable on Mac only', () => {
    const title = 'Open Links in Arc Spaces'
    expect(getBrowserPaneSearchEntries({ isMac: true }).some((e) => e.title === title)).toBe(true)
    expect(getBrowserPaneSearchEntries({ isMac: false }).some((e) => e.title === title)).toBe(false)
  })
})
