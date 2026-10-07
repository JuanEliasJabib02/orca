import { describe, expect, it, vi } from 'vitest'
import { createTaskDeleteCompletion } from './task-note-delete-cleanup'

const TARGETS = [
  { id: 'be-1', instanceId: 'inst-be', hostId: undefined },
  { id: 'ad-1', instanceId: 'inst-ad', hostId: undefined }
]

describe('createTaskDeleteCompletion', () => {
  it('does not fire while a target is still missing', () => {
    const onAllDeleted = vi.fn()
    const onDeleted = createTaskDeleteCompletion(TARGETS, onAllDeleted)

    onDeleted([{ id: 'be-1', executionHostId: null }])

    expect(onAllDeleted).not.toHaveBeenCalled()
  })

  it('fires once when one report covers every target', () => {
    const onAllDeleted = vi.fn()
    const onDeleted = createTaskDeleteCompletion(TARGETS, onAllDeleted)

    onDeleted([
      { id: 'be-1', executionHostId: null },
      { id: 'ad-1', executionHostId: null }
    ])
    onDeleted([{ id: 'ad-1', executionHostId: null }])

    expect(onAllDeleted).toHaveBeenCalledTimes(1)
  })

  it('accumulates targets reported in separate batches', () => {
    const onAllDeleted = vi.fn()
    const onDeleted = createTaskDeleteCompletion(TARGETS, onAllDeleted)

    onDeleted([{ id: 'be-1', executionHostId: null }])
    onDeleted([{ id: 'ad-1', executionHostId: null }])

    expect(onAllDeleted).toHaveBeenCalledTimes(1)
  })

  it('tells the same id apart across hosts', () => {
    const onAllDeleted = vi.fn()
    const onDeleted = createTaskDeleteCompletion(
      [{ id: 'be-1', instanceId: 'inst-ssh', hostId: 'ssh:box' }],
      onAllDeleted
    )

    onDeleted([{ id: 'be-1', executionHostId: null }])
    expect(onAllDeleted).not.toHaveBeenCalled()

    onDeleted([{ id: 'be-1', executionHostId: 'ssh:box' }])
    expect(onAllDeleted).toHaveBeenCalledTimes(1)
  })

  it('ignores reports for worktrees outside the task', () => {
    const onAllDeleted = vi.fn()
    const onDeleted = createTaskDeleteCompletion(TARGETS, onAllDeleted)

    onDeleted([{ id: 'other', executionHostId: null }])

    expect(onAllDeleted).not.toHaveBeenCalled()
  })

  it('never fires for a task with nothing to delete', () => {
    const onAllDeleted = vi.fn()
    const onDeleted = createTaskDeleteCompletion([], onAllDeleted)

    onDeleted([{ id: 'be-1', executionHostId: null }])

    expect(onAllDeleted).not.toHaveBeenCalled()
  })
})
