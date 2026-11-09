import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getLineBlame, getFileBlame } = vi.hoisted(() => ({
  getLineBlame: vi.fn(),
  getFileBlame: vi.fn()
}))

vi.mock('../git/line-blame', () => ({ getLineBlame, getFileBlame }))

import { createLocalGitProvider } from './local-git-provider'

const WT = '/repo/wt'

// Why a fork-owned file: inline blame is an Orca Pro Max feature; these pin the provider's local
// arm to the blame free functions with the caller's runtime options and no admission tier.
describe('local git provider blame', () => {
  beforeEach(() => {
    getLineBlame.mockReset()
    getFileBlame.mockReset()
  })

  it('getLineBlame calls the local free function as the runtime local arm does', async () => {
    await createLocalGitProvider().getLineBlame(WT, 'a', 3)
    expect(getLineBlame).toHaveBeenCalledTimes(1)
    expect(getLineBlame).toHaveBeenCalledWith(WT, 'a', 3, {})
  })

  it('getFileBlame calls the local free function as the runtime local arm does', async () => {
    await createLocalGitProvider().getFileBlame(WT, 'a')
    expect(getFileBlame).toHaveBeenCalledTimes(1)
    expect(getFileBlame).toHaveBeenCalledWith(WT, 'a', {})
  })

  it('keeps the WSL distro on both blame calls', async () => {
    const provider = createLocalGitProvider({ wslDistro: 'Ubuntu' })
    await provider.getLineBlame(WT, 'a', 3)
    await provider.getFileBlame(WT, 'a')
    expect(getLineBlame.mock.calls[0]?.at(-1)).toMatchObject({ wslDistro: 'Ubuntu' })
    expect(getFileBlame.mock.calls[0]?.at(-1)).toMatchObject({ wslDistro: 'Ubuntu' })
  })
})
