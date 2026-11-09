import { describe, expect, it } from 'vitest'
import {
  resolveFullLaneDropIndex,
  toWorktreeDropIndex
} from './workspace-board/drag/workspace-kanban-filtered-drop-index'

describe('toWorktreeDropIndex', () => {
  it('is the identity when every card holds one worktree', () => {
    for (let index = 0; index <= 4; index++) {
      expect(toWorktreeDropIndex([1, 1, 1, 1], index)).toBe(index)
    }
  })

  it('counts a task card as every worktree it holds', () => {
    // Cards: plain, a three-worktree task, plain.
    const counts = [1, 3, 1]

    expect(toWorktreeDropIndex(counts, 0)).toBe(0)
    expect(toWorktreeDropIndex(counts, 1)).toBe(1)
    expect(toWorktreeDropIndex(counts, 2)).toBe(4)
    expect(toWorktreeDropIndex(counts, 3)).toBe(5)
  })

  it('gives a project header no weight', () => {
    // Cards: header, plain, header, a two-worktree task.
    const counts = [0, 1, 0, 2]

    expect(toWorktreeDropIndex(counts, 1)).toBe(0)
    expect(toWorktreeDropIndex(counts, 2)).toBe(1)
    expect(toWorktreeDropIndex(counts, 3)).toBe(1)
    expect(toWorktreeDropIndex(counts, 4)).toBe(3)
  })

  it('clamps an index outside the lane to its ends', () => {
    expect(toWorktreeDropIndex([2, 1], -1)).toBe(0)
    expect(toWorktreeDropIndex([2, 1], 9)).toBe(3)
    expect(toWorktreeDropIndex([], 0)).toBe(0)
  })

  it('lands on the right full-lane slot once composed with a searched lane', () => {
    // Full lane: a, [t1 t2 t3], b, c. The search hides `a`, so the view is [task, b].
    const fullLaneIds = ['a', 't1', 't2', 't3', 'b', 'c']
    const renderedIds = ['t1', 't2', 't3', 'b']
    const counts = [3, 1]

    expect(
      resolveFullLaneDropIndex({
        fullLaneIds,
        renderedIds,
        filteredDropIndex: toWorktreeDropIndex(counts, 1)
      })
    ).toBe(4)
    expect(
      resolveFullLaneDropIndex({
        fullLaneIds,
        renderedIds,
        filteredDropIndex: toWorktreeDropIndex(counts, 2)
      })
    ).toBe(5)
  })
})
