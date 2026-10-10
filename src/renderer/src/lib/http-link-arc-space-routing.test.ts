import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProjectGroup } from '../../../shared/project-group-types'
import {
  openHttpLink,
  registerHttpLinkStoreAccessor,
  registerWorkspaceHttpLinkBrowserOpener
} from './http-link-routing'

const actionSpace: ProjectGroup = {
  id: 'action',
  name: 'Action Black',
  parentPath: null,
  parentGroupId: null,
  createdFrom: 'manual',
  tabOrder: 0,
  isCollapsed: false,
  color: null,
  createdAt: 0,
  updatedAt: 0
}

describe('Arc space routing for system-browser links', () => {
  const openUrlMock = vi.fn()
  const createBrowserTabMock = vi.fn()
  const storeState = {
    settings: {} as {
      openLinksInApp?: boolean
      openLinksInArcSpaces?: boolean
      arcSpaceNameBySidebarSpaceId?: Record<string, string>
    },
    setActiveWorktree: vi.fn(),
    createBrowserTab: createBrowserTabMock,
    repos: [{ id: 'r-action', displayName: 'backend', projectGroupId: 'action' }],
    projectGroups: [actionSpace],
    folderWorkspaces: [],
    activeSidebarSpaceGroupId: 'action'
  }

  beforeEach(() => {
    vi.clearAllMocks()
    registerHttpLinkStoreAccessor(() => storeState)
    registerWorkspaceHttpLinkBrowserOpener(vi.fn(() => Promise.resolve()))
    vi.stubGlobal('window', { api: { shell: { openUrl: openUrlMock } } })
  })

  afterEach(() => {
    registerWorkspaceHttpLinkBrowserOpener(null)
    vi.unstubAllGlobals()
  })

  it("sends the worktree's Arc space with the link when the opt-in is on", () => {
    storeState.settings = {
      openLinksInArcSpaces: true,
      arcSpaceNameBySidebarSpaceId: { action: 'Action' }
    }

    openHttpLink('https://example.com/', { worktreeId: 'r-action::/repo' })

    expect(openUrlMock).toHaveBeenCalledWith('https://example.com/', { arcSpace: 'Action' })
  })

  it('keeps the one-argument call while the opt-in is off', () => {
    storeState.settings = {
      openLinksInArcSpaces: false,
      arcSpaceNameBySidebarSpaceId: { action: 'Action' }
    }

    openHttpLink('https://example.com/', { worktreeId: 'r-action::/repo' })

    expect(openUrlMock.mock.calls).toEqual([['https://example.com/']])
  })

  it('leaves in-app routing untouched', () => {
    storeState.settings = {
      openLinksInApp: true,
      openLinksInArcSpaces: true,
      arcSpaceNameBySidebarSpaceId: { action: 'Action' }
    }

    openHttpLink('https://example.com/', { worktreeId: 'r-action::/repo' })

    expect(openUrlMock).not.toHaveBeenCalled()
    expect(createBrowserTabMock).toHaveBeenCalledWith('r-action::/repo', 'https://example.com/', {
      activate: true
    })
  })
})
