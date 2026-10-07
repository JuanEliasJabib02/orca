import { beforeEach, describe, expect, it, vi } from 'vitest'
const applySpotlightEnvChange = vi.hoisted(() => vi.fn(async (_envKey: string) => {}))
const store = vi.hoisted(() => {
  type StoreState = {
    spotlightEnvByTaskKey: Record<string, string>
    setSpotlightEnvForTask: (taskKey: string, env: string) => void
  }
  const state: StoreState = { spotlightEnvByTaskKey: {}, setSpotlightEnvForTask: () => {} }
  return { state }
})

vi.mock('@/store', () => ({ useAppStore: { getState: () => store.state } }))
vi.mock('@/lib/spotlight-server-autostart', () => ({ applySpotlightEnvChange }))

import { switchSpotlightEnv } from './spotlight-env-switch'

describe('switchSpotlightEnv', () => {
  const setSpotlightEnvForTask = vi.fn<(taskKey: string, env: string) => void>()

  beforeEach(() => {
    vi.clearAllMocks()
    store.state.spotlightEnvByTaskKey = {}
    store.state.setSpotlightEnvForTask = setSpotlightEnvForTask
  })

  it('saves the environment, then restarts the servers of that key', () => {
    const order: string[] = []
    setSpotlightEnvForTask.mockImplementation(() => order.push('save'))
    applySpotlightEnvChange.mockImplementation(async () => {
      order.push('apply')
    })

    switchSpotlightEnv('AX-3447', 'dev')

    expect(setSpotlightEnvForTask).toHaveBeenCalledWith('AX-3447', 'dev')
    expect(applySpotlightEnvChange).toHaveBeenCalledWith('AX-3447')
    expect(order).toEqual(['save', 'apply'])
  })

  it('does nothing when the environment is already the saved one', () => {
    store.state.spotlightEnvByTaskKey = { 'AX-3447': 'dev' }

    switchSpotlightEnv('AX-3447', 'dev')

    expect(setSpotlightEnvForTask).not.toHaveBeenCalled()
    expect(applySpotlightEnvChange).not.toHaveBeenCalled()
  })

  it('treats a missing entry as Local', () => {
    switchSpotlightEnv('AX-3447', 'local')

    expect(setSpotlightEnvForTask).not.toHaveBeenCalled()
    expect(applySpotlightEnvChange).not.toHaveBeenCalled()
  })
})
