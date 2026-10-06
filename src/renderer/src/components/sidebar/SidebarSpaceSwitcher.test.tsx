// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'
import type { ReactNode } from 'react'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '@/store'
import { resetAgentStatusEpochClockForTests } from '@/lib/agent-status-epoch-clock'
import type { AgentStatusEntry } from '../../../../shared/agent-status-types'
import type { ProjectGroup } from '../../../../shared/project-group-types'
import type { Repo } from '../../../../shared/repo-types'
import { makePaneKey } from '../../../../shared/stable-pane-id'
import type { TerminalTab } from '../../../../shared/terminal-tab-types'
import type { Worktree } from '../../../../shared/worktree/types'
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

function makeRepo(id: string, projectGroupId: string | null): Repo {
  return {
    id,
    path: `/tmp/${id}`,
    displayName: id,
    badgeColor: '#000000',
    addedAt: 0,
    projectGroupId
  }
}

function makeWorktree(id: string, repoId: string, overrides: Partial<Worktree> = {}): Worktree {
  return {
    id,
    repoId,
    path: `/tmp/${id}`,
    branch: 'refs/heads/main',
    head: 'abc123',
    isBare: false,
    isMainWorktree: false,
    linkedIssue: null,
    linkedPR: null,
    linkedLinearIssue: null,
    isArchived: false,
    comment: '',
    isUnread: false,
    isPinned: false,
    displayName: id,
    sortOrder: 0,
    lastActivityAt: 0,
    ...overrides
  }
}

function makeTab(id: string, worktreeId: string): TerminalTab {
  return {
    id,
    ptyId: null,
    worktreeId,
    title: id,
    customTitle: null,
    color: null,
    sortOrder: 0,
    createdAt: 0
  }
}

const LEAF_ID = '11111111-1111-4111-8111-111111111111'

function makeAgentStatus(tabId: string, state: AgentStatusEntry['state']): AgentStatusEntry {
  return {
    state,
    prompt: '',
    updatedAt: Date.now(),
    stateStartedAt: Date.now(),
    stateHistory: [],
    paneKey: makePaneKey(tabId, LEAF_ID)
  }
}

const setActiveGroupId = vi.fn()
const createProjectGroup = vi.fn()
const moveProjectToGroup = vi.fn()

function seedStore(state: Partial<ReturnType<typeof useAppStore.getState>>): void {
  act(() => {
    useAppStore.setState({
      setActiveSidebarSpaceGroupId: setActiveGroupId,
      createProjectGroup,
      moveProjectToGroup,
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
    resetAgentStatusEpochClockForTests()
    createProjectGroup.mockResolvedValue(makeGroup('created'))
    moveProjectToGroup.mockResolvedValue(true)
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

  it('lists each top-level group in tab order, then the new-space button', () => {
    seedStore({
      projectGroups: [
        makeGroup('personal', { name: 'Personal', tabOrder: 2 }),
        makeGroup('work', { name: 'Work', tabOrder: 1 }),
        makeGroup('nested', { name: 'Nested', tabOrder: 0, parentGroupId: 'work' })
      ]
    })
    const { container } = render(<SidebarSpaceSwitcher />)

    expect(spaceButtons().map((button) => button.getAttribute('aria-label'))).toEqual([
      'Work',
      'Personal',
      'New space'
    ])
    expect(container.querySelectorAll('svg.lucide-layers')).toHaveLength(0)
    expect(container.querySelectorAll('svg.lucide-code')).toHaveLength(2)
    expect(container.querySelectorAll('svg.lucide-plus')).toHaveLength(1)
  })

  it('names each button in its tooltip', () => {
    seedStore({ projectGroups: [makeGroup('work', { name: 'Work' })] })
    render(<SidebarSpaceSwitcher />)

    const tooltips = screen.getAllByTestId('tooltip').map((tooltip) => tooltip.textContent)
    // Why the F1 suffix: the first space shows its effective key chip after the name.
    expect(tooltips).toEqual(['WorkF1', 'New space'])
  })

  it('switches spaces through the store setter', async () => {
    seedStore({
      projectGroups: [
        makeGroup('work', { name: 'Work', tabOrder: 0 }),
        makeGroup('personal', { name: 'Personal', tabOrder: 1 })
      ],
      activeSidebarSpaceGroupId: 'work'
    })
    render(<SidebarSpaceSwitcher />)

    await userEvent.click(screen.getByRole('button', { name: 'Personal' }))
    expect(setActiveGroupId).toHaveBeenLastCalledWith('personal')

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
    expect(screen.getByRole('button', { name: 'New space' })).not.toHaveAttribute('aria-pressed')
  })

  it.each([
    ['no active space', null],
    ['a deleted group', 'gone'],
    ['a nested group', 'nested']
  ])('treats the first space as active for %s', (_label, activeId) => {
    seedStore({
      projectGroups: [
        makeGroup('work', { name: 'Work', tabOrder: 0 }),
        makeGroup('personal', { name: 'Personal', tabOrder: 1 }),
        makeGroup('nested', { name: 'Nested', parentGroupId: 'work' })
      ],
      activeSidebarSpaceGroupId: activeId
    })
    render(<SidebarSpaceSwitcher />)

    expect(screen.getByRole('button', { name: 'Work' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Personal' })).toHaveAttribute(
      'aria-pressed',
      'false'
    )
  })

  it('creates a space from the dialog and switches to it', async () => {
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
    await waitFor(() => expect(setActiveGroupId).toHaveBeenCalledWith('created'))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(moveProjectToGroup).not.toHaveBeenCalled()
  })

  it('moves every spaceless project on its host into the first space', async () => {
    seedStore({
      projectGroups: [],
      repos: [
        makeRepo('loose', null),
        makeRepo('orphan', 'deleted-group'),
        { ...makeRepo('remote', null), connectionId: 'devbox' }
      ]
    })
    render(<SidebarSpaceSwitcher />)

    await userEvent.click(screen.getByRole('button', { name: 'New space' }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.type(within(dialog).getByRole('textbox'), 'Action Black')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(setActiveGroupId).toHaveBeenCalledWith('created'))
    expect(moveProjectToGroup.mock.calls).toEqual([
      ['loose', 'created'],
      ['orphan', 'created']
    ])
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
  describe('attention dot', () => {
    const spaces = [
      makeGroup('work', { name: 'Work', tabOrder: 0 }),
      makeGroup('personal', { name: 'Personal', tabOrder: 1 })
    ]

    function dotOf(button: HTMLElement): HTMLElement | null {
      return button.closest('.relative')?.querySelector('[data-attention]') ?? null
    }

    function seedWorkAttention(
      attention: 'unread' | 'permission' | 'unread-tab',
      activeSpace: string | null
    ): void {
      const isUnread = attention === 'unread'
      seedStore({
        projectGroups: spaces,
        activeSidebarSpaceGroupId: activeSpace,
        repos: [makeRepo('r-work', 'work'), makeRepo('r-personal', 'personal')],
        worktreesByRepo: {
          'r-work': [makeWorktree('wt-work', 'r-work', { isUnread })],
          'r-personal': [makeWorktree('wt-personal', 'r-personal')]
        },
        tabsByWorktree: { 'wt-work': [makeTab('tab-work', 'wt-work')] },
        unreadTerminalTabs: attention === 'unread-tab' ? { 'tab-work': true } : {},
        agentStatusByPaneKey:
          attention === 'permission'
            ? { [makePaneKey('tab-work', LEAF_ID)]: makeAgentStatus('tab-work', 'blocked') }
            : {},
        agentStatusEpoch: 1
      })
    }

    it('shows nothing when no space needs attention', () => {
      seedStore({ projectGroups: spaces, activeSidebarSpaceGroupId: 'personal' })
      const { container } = render(<SidebarSpaceSwitcher />)

      expect(container.querySelector('[data-attention]')).toBeNull()
    })

    it.each([
      ['unread', 'Unread', 'unread'],
      ['unread-tab', 'Unread', 'unread'],
      ['permission', 'Needs permission', 'permission']
    ] as const)(
      'marks an inactive space for %s and names the state in its label and tooltip',
      (source, stateLabel, expectedKind) => {
        seedWorkAttention(source, 'personal')
        render(<SidebarSpaceSwitcher />)

        const button = screen.getByRole('button', { name: `Work · ${stateLabel}` })
        expect(dotOf(button)).toHaveAttribute('data-attention', expectedKind)
        expect(
          screen
            .getAllByTestId('tooltip')
            .some((tooltip) => tooltip.textContent?.startsWith(`Work · ${stateLabel}`))
        ).toBe(true)
        expect(dotOf(screen.getByRole('button', { name: 'Personal' }))).toBeNull()
      }
    )

    it('uses the permission color for permission and a neutral foreground for unread', () => {
      seedWorkAttention('permission', 'personal')
      const { unmount } = render(<SidebarSpaceSwitcher />)
      const permissionDot = dotOf(screen.getByRole('button', { name: 'Work · Needs permission' }))
      expect(permissionDot).toHaveClass('data-[attention=permission]:bg-agent-question')
      unmount()

      seedWorkAttention('unread', 'personal')
      render(<SidebarSpaceSwitcher />)
      const unreadDot = dotOf(screen.getByRole('button', { name: 'Work · Unread' }))
      expect(unreadDot).toHaveClass('data-[attention=unread]:bg-foreground')
    })

    it('keeps the dot out of the dimmed wrapper so it stays at full strength', () => {
      seedWorkAttention('permission', 'personal')
      render(<SidebarSpaceSwitcher />)

      const button = screen.getByRole('button', { name: 'Work · Needs permission' })
      expect(button.closest('.opacity-40')).not.toBeNull()
      expect(dotOf(button)?.closest('.opacity-40')).toBeNull()
      expect(dotOf(button)).toHaveAttribute('aria-hidden', 'true')
    })

    it.each(['unread', 'permission'] as const)(
      'hides the dot on the space you are viewing (%s)',
      (source) => {
        seedWorkAttention(source, 'work')
        const { container } = render(<SidebarSpaceSwitcher />)

        expect(screen.getByRole('button', { name: 'Work' })).toHaveAttribute('aria-pressed', 'true')
        expect(container.querySelector('[data-attention]')).toBeNull()
      }
    )

    it('shows the dot again once you switch away from that space', () => {
      seedWorkAttention('unread', 'work')
      const { container } = render(<SidebarSpaceSwitcher />)
      expect(container.querySelector('[data-attention]')).toBeNull()

      act(() => useAppStore.setState({ activeSidebarSpaceGroupId: 'personal' }))

      expect(container.querySelectorAll('[data-attention]')).toHaveLength(1)
      expect(screen.getByRole('button', { name: 'Work · Unread' })).toBeInTheDocument()
    })

    it('clears the dot when the agent is answered', () => {
      seedWorkAttention('permission', 'personal')
      render(<SidebarSpaceSwitcher />)
      expect(screen.getByRole('button', { name: 'Work · Needs permission' })).toBeInTheDocument()

      act(() => useAppStore.setState({ agentStatusByPaneKey: {}, agentStatusEpoch: 2 }))

      expect(screen.getByRole('button', { name: 'Work' })).toBeInTheDocument()
    })

    it('ignores spaceless projects, which every space already shows', () => {
      seedStore({
        projectGroups: spaces,
        activeSidebarSpaceGroupId: 'work',
        repos: [makeRepo('r-loose', null)],
        worktreesByRepo: { 'r-loose': [makeWorktree('wt-loose', 'r-loose', { isUnread: true })] }
      })
      const { container } = render(<SidebarSpaceSwitcher />)

      expect(container.querySelector('[data-attention]')).toBeNull()
    })

    it('never puts a dot on the new-space button', () => {
      seedWorkAttention('permission', 'personal')
      render(<SidebarSpaceSwitcher />)

      expect(dotOf(screen.getByRole('button', { name: 'New space' }))).toBeNull()
    })
  })
})
