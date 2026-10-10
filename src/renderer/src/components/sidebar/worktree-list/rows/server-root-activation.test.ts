import { beforeEach, describe, expect, it, vi } from 'vitest'

const selectSpotlightTerminalTab = vi.hoisted(() => vi.fn((_worktreeId: string) => true))

vi.mock('@/lib/open-spotlight-terminal-tab', () => ({ selectSpotlightTerminalTab }))

import { SERVERS_LANE_KEY } from '../grouping/server-root-lane'
import { NO_TASK_LANE_KEY } from '../grouping/worktree-task-key'
import { getServerRootActivateHandler } from './server-root-activation'

describe('getServerRootActivateHandler', () => {
  beforeEach(() => {
    selectSpotlightTerminalTab.mockClear()
  })

  it('puts a Servers row on its root Spotlight terminal once the row opened the root', () => {
    getServerRootActivateHandler(SERVERS_LANE_KEY, 'backend::/root')?.()

    expect(selectSpotlightTerminalTab).toHaveBeenCalledTimes(1)
    expect(selectSpotlightTerminalTab).toHaveBeenCalledWith('backend::/root')
  })

  it('hands every Servers row of one root the same handler, so its memoized card keeps props', () => {
    const first = getServerRootActivateHandler(SERVERS_LANE_KEY, 'admin::/root')

    expect(getServerRootActivateHandler(SERVERS_LANE_KEY, 'admin::/root')).toBe(first)
    expect(getServerRootActivateHandler(SERVERS_LANE_KEY, 'backend::/root')).not.toBe(first)
  })

  it('leaves rows of every other section to the plain open', () => {
    expect(getServerRootActivateHandler(NO_TASK_LANE_KEY, 'backend::/root')).toBeUndefined()
    expect(getServerRootActivateHandler('pinned', 'backend::/root')).toBeUndefined()
    expect(getServerRootActivateHandler('task:sidebar', 'backend::/root')).toBeUndefined()
  })
})
