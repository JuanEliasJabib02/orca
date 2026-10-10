import { describe, expect, it } from 'vitest'
import type { Worktree } from '../../../../shared/worktree/types'
import {
  formatSpotlightPortLabel,
  mergeSpotlightHolderPorts,
  selectRowWorkspacePorts,
  selectSpotlightPortLabel,
  type SpotlightPortsState
} from './spotlight-holder-ports'
import { makeOwnedPort, makePortScan } from './spotlight-holder-ports-test-fixtures'
import { holdersByRepo, makeTaskWorktree } from './worktree-list/rows/task-spotlight-test-fixtures'

const ROOT = makeTaskWorktree('repo-a::/root', 'repo-a', { isMainWorktree: true })
const HOLDER = makeTaskWorktree('repo-a::/holder', 'repo-a')
const OTHER = makeTaskWorktree('repo-a::/other', 'repo-a')

function stateOf(
  ports: ReturnType<typeof makeOwnedPort>[],
  holder: Worktree | null = HOLDER
): SpotlightPortsState {
  return {
    workspacePortScan: makePortScan(ports),
    spotlightByRepo: holder ? holdersByRepo({ 'repo-a': holder.id }) : {},
    worktreesByRepo: { 'repo-a': [ROOT, HOLDER, OTHER] }
  }
}

function portNumbers(ports: readonly { port: number }[]): number[] {
  return ports.map((port) => port.port)
}

describe('mergeSpotlightHolderPorts', () => {
  it('hands back the holder own ports untouched when the root has none', () => {
    const own = [makeOwnedPort(HOLDER.id, 4000)]

    expect(mergeSpotlightHolderPorts(own, [])).toBe(own)
  })

  it('adds the root ports to the holder own, lowest port first', () => {
    const own = [makeOwnedPort(HOLDER.id, 9229)]
    const root = [makeOwnedPort(ROOT.id, 8080), makeOwnedPort(ROOT.id, 3000)]

    expect(portNumbers(mergeSpotlightHolderPorts(own, root))).toEqual([3000, 8080, 9229])
  })

  it('dedupes by host and port, keeping the holder own entry', () => {
    const own = [makeOwnedPort(HOLDER.id, 8080)]
    const root = [makeOwnedPort(ROOT.id, 8080), makeOwnedPort(ROOT.id, 8080, '::1')]

    const merged = mergeSpotlightHolderPorts(own, root)

    expect(merged).toHaveLength(2)
    expect(merged[0]).toBe(own[0])
    expect(merged.map((port) => port.connectHost).sort()).toEqual(['127.0.0.1', '::1'])
  })

  it('returns the same array for the same inputs so store selectors stay stable', () => {
    const own = [makeOwnedPort(HOLDER.id, 4000)]
    const root = [makeOwnedPort(ROOT.id, 8080)]

    expect(mergeSpotlightHolderPorts(own, root)).toBe(mergeSpotlightHolderPorts(own, root))
  })
})

describe('formatSpotlightPortLabel', () => {
  it('shows nothing when nothing listens', () => {
    expect(formatSpotlightPortLabel([])).toBeNull()
  })

  it('shows a single port as :port', () => {
    expect(formatSpotlightPortLabel([makeOwnedPort(ROOT.id, 8080)])).toBe(':8080')
  })

  it('shows the lowest port first and counts the rest', () => {
    const ports = [makeOwnedPort(ROOT.id, 8080), makeOwnedPort(ROOT.id, 3000)]

    expect(formatSpotlightPortLabel(ports)).toBe(':3000 +1')
  })

  it('leads with the configured port when it listens', () => {
    const ports = [makeOwnedPort(ROOT.id, 3000), makeOwnedPort(ROOT.id, 8080)]

    expect(formatSpotlightPortLabel(ports, 8080)).toBe(':8080 +1')
  })

  it('falls back to the lowest port when the configured one does not listen', () => {
    const ports = [makeOwnedPort(ROOT.id, 3000), makeOwnedPort(ROOT.id, 8080)]

    expect(formatSpotlightPortLabel(ports, 4000)).toBe(':3000 +1')
  })

  it('counts one port bound on two hosts once', () => {
    const ports = [makeOwnedPort(ROOT.id, 8080), makeOwnedPort(ROOT.id, 8080, '::1')]

    expect(formatSpotlightPortLabel(ports)).toBe(':8080')
  })
})

describe('selectRowWorkspacePorts', () => {
  const rootPort = makeOwnedPort(ROOT.id, 8080)
  const holderPort = makeOwnedPort(HOLDER.id, 4000)
  const otherPort = makeOwnedPort(OTHER.id, 5000)

  it('gives the row holding the Spotlight the root ports besides its own', () => {
    const state = stateOf([rootPort, holderPort, otherPort])

    expect(portNumbers(selectRowWorkspacePorts(state, HOLDER))).toEqual([4000, 8080])
  })

  it('gives the holder the root ports even with none of its own', () => {
    expect(portNumbers(selectRowWorkspacePorts(stateOf([rootPort]), HOLDER))).toEqual([8080])
  })

  it('leaves every other task row with only its own ports', () => {
    const state = stateOf([rootPort, holderPort, otherPort])

    expect(portNumbers(selectRowWorkspacePorts(state, OTHER))).toEqual([5000])
  })

  it('stops merging the root ports once the row no longer holds the Spotlight', () => {
    const state = stateOf([rootPort, holderPort, otherPort], OTHER)

    expect(portNumbers(selectRowWorkspacePorts(state, HOLDER))).toEqual([4000])
    expect(portNumbers(selectRowWorkspacePorts(state, OTHER))).toEqual([5000, 8080])
  })

  it('leaves every row with only its own ports while the Spotlight is off', () => {
    const state = stateOf([rootPort, holderPort], null)

    expect(portNumbers(selectRowWorkspacePorts(state, HOLDER))).toEqual([4000])
  })

  it('keeps the root row showing exactly its own ports', () => {
    const state = stateOf([rootPort, holderPort])

    expect(selectRowWorkspacePorts(state, ROOT)).toEqual([rootPort])
  })

  it('shows nothing before the first scan', () => {
    const state: SpotlightPortsState = { ...stateOf([]), workspacePortScan: null }

    expect(selectRowWorkspacePorts(state, HOLDER)).toHaveLength(0)
  })
})

describe('selectSpotlightPortLabel', () => {
  const rootPort = makeOwnedPort(ROOT.id, 8080)

  it('labels the row holding the Spotlight with the port the root listens on', () => {
    expect(selectSpotlightPortLabel(stateOf([rootPort]), HOLDER)).toBe(':8080')
  })

  it('shows several listeners as the first port plus a count', () => {
    const state = stateOf([rootPort, makeOwnedPort(ROOT.id, 3000)])

    expect(selectSpotlightPortLabel(state, HOLDER)).toBe(':3000 +1')
  })

  it('leads with the repo configured port when it listens', () => {
    const state = stateOf([rootPort, makeOwnedPort(ROOT.id, 3000)])

    expect(selectSpotlightPortLabel(state, HOLDER, 8080)).toBe(':8080 +1')
  })

  it('labels the root row too while the Spotlight is on', () => {
    expect(selectSpotlightPortLabel(stateOf([rootPort]), ROOT)).toBe(':8080')
  })

  it('does not label the other task rows of the repo', () => {
    expect(selectSpotlightPortLabel(stateOf([rootPort]), OTHER)).toBeNull()
  })

  it('does not label any row while the Spotlight is off', () => {
    const state = stateOf([rootPort], null)

    expect(selectSpotlightPortLabel(state, HOLDER)).toBeNull()
    expect(selectSpotlightPortLabel(state, ROOT)).toBeNull()
  })

  it('shows nothing while nothing listens', () => {
    expect(selectSpotlightPortLabel(stateOf([]), HOLDER)).toBeNull()
  })
})
