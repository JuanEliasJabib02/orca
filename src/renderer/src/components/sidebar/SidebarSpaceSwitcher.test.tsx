// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'
import type { ReactNode } from 'react'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '@/store'
import type { ProjectGroup } from '../../../../shared/project-group-types'
import { SidebarSpaceSwitcher } from './SidebarSpaceSwitcher'

// Why: tooltip content only mounts on hover; render it inline to assert the label text.
vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: ReactNode }) => (
    <span data-testid="tooltip">{children}</span>
  )
}))

const initialState = useAppStore.getInitialState()

function makeGroup(id: string, overrides: Partial<ProjectGroup> = {}): ProjectGroup {
  return {
    id,
    name: id,
    parentPath: null,
    parentGroupId: null,
    createdFrom: 'manual',
    tabOrder: 0,
    isCollapsed: false,
    color: null,
    createdAt: 0,
    updatedAt: 0,
    ...overrides
  }
}

const setActiveGroupId = vi.fn()
const createProjectGroup = vi.fn()

function seedStore(state: Partial<ReturnType<typeof useAppStore.getState>>): void {
  act(() => {
    useAppStore.setState({
      setActiveSidebarSpaceGroupId: setActiveGroupId,
      createProjectGroup,
      ...state
    })
  })
}

function spaceButtons(): HTMLElement[] {
  return screen.getAllByRole('button')
}

describe('SidebarSpaceSwitcher', () => {
  beforeEach(() => {
    useAppStore.setState(initialState, true)
    createProjectGroup.mockResolvedValue(makeGroup('created'))
  })

  afterEach(() => {
    cleanup()
    useAppStore.setState(initialState, true)
    vi.clearAllMocks()
  })

  it('renders only the new-space button when there are no spaces', () => {
    seedStore({ projectGroups: [] })
    render(<SidebarSpaceSwitcher />)

    expect(spaceButtons().map((button) => button.getAttribute('aria-label'))).toEqual(['New space'])
  })

  it('lists All, then each top-level group in tab order, then the new-space button', () => {
    seedStore({
      projectGroups: [
        makeGroup('personal', { name: 'Personal', tabOrder: 2 }),
        makeGroup('work', { name: 'Work', tabOrder: 1 }),
        makeGroup('nested', { name: 'Nested', tabOrder: 0, parentGroupId: 'work' })
      ]
    })
    const { container } = render(<SidebarSpaceSwitcher />)

    expect(spaceButtons().map((button) => button.getAttribute('aria-label'))).toEqual([
      'All',
      'Work',
      'Personal',
      'New space'
    ])
    expect(container.querySelectorAll('svg.lucide-layers')).toHaveLength(1)
    expect(container.querySelectorAll('svg.lucide-code')).toHaveLength(2)
    expect(container.querySelectorAll('svg.lucide-plus')).toHaveLength(1)
  })

  it('names each button in its tooltip', () => {
    seedStore({ projectGroups: [makeGroup('work', { name: 'Work' })] })
    render(<SidebarSpaceSwitcher />)

    expect(screen.getAllByTestId('tooltip').map((tooltip) => tooltip.textContent)).toEqual([
      'All',
      'Work',
      'New space'
    ])
  })

  it('switches to a space, and back to All, through the store setter', async () => {
    seedStore({
      projectGroups: [makeGroup('work', { name: 'Work' })],
      activeSidebarSpaceGroupId: 'work'
    })
    render(<SidebarSpaceSwitcher />)

    await userEvent.click(screen.getByRole('button', { name: 'All' }))
    expect(setActiveGroupId).toHaveBeenLastCalledWith(null)

    await userEvent.click(screen.getByRole('button', { name: 'Work' }))
    expect(setActiveGroupId).toHaveBeenLastCalledWith('work')
  })

  it('marks the active space as pressed and the rest as not', () => {
    seedStore({
      projectGroups: [
        makeGroup('work', { name: 'Work', tabOrder: 0 }),
        makeGroup('personal', { name: 'Personal', tabOrder: 1 })
      ],
      activeSidebarSpaceGroupId: 'personal'
    })
    render(<SidebarSpaceSwitcher />)

    expect(screen.getByRole('button', { name: 'Personal' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Work' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: 'New space' })).not.toHaveAttribute('aria-pressed')
  })

  it.each([
    ['no active space', null],
    ['a deleted group', 'gone'],
    ['a nested group', 'nested']
  ])('treats All as active for %s', (_label, activeId) => {
    seedStore({
      projectGroups: [
        makeGroup('work', { name: 'Work' }),
        makeGroup('nested', { name: 'Nested', parentGroupId: 'work' })
      ],
      activeSidebarSpaceGroupId: activeId
    })
    render(<SidebarSpaceSwitcher />)

    expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Work' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('creates a space from the dialog, then shows All', async () => {
    seedStore({ projectGroups: [makeGroup('work', { name: 'Work' })] })
    render(<SidebarSpaceSwitcher />)

    await userEvent.click(screen.getByRole('button', { name: 'New space' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('New Space')).toBeInTheDocument()
    expect(
      within(dialog).getByText('Creates a project group you can switch to from the bottom bar.')
    ).toBeInTheDocument()

    const nameInput = within(dialog).getByRole('textbox')
    expect(nameInput).toHaveValue('')
    await userEvent.type(nameInput, '  Side projects ')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(createProjectGroup).toHaveBeenCalledWith('Side projects'))
    await waitFor(() => expect(setActiveGroupId).toHaveBeenCalledWith(null))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('keeps the active space when the group could not be created', async () => {
    createProjectGroup.mockResolvedValue(null)
    seedStore({
      projectGroups: [makeGroup('work', { name: 'Work' })],
      activeSidebarSpaceGroupId: 'work'
    })
    render(<SidebarSpaceSwitcher />)

    await userEvent.click(screen.getByRole('button', { name: 'New space' }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.type(within(dialog).getByRole('textbox'), 'Side projects')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(createProjectGroup).toHaveBeenCalledWith('Side projects'))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(setActiveGroupId).not.toHaveBeenCalled()
  })
})
