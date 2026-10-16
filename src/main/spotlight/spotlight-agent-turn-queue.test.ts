import { describe, expect, it } from 'vitest'
import { SpotlightTurnQueue } from './spotlight-agent-turn-queue'

function makeQueue(): SpotlightTurnQueue {
  let clock = 0
  return new SpotlightTurnQueue(() => ++clock)
}

describe('SpotlightTurnQueue', () => {
  it('grants tasks with no project in common at the same time', () => {
    const queue = makeQueue()
    const a = queue.request({ paneKey: 'pa', taskKey: 'AX-1', repoIds: ['back', 'admin'] })
    const b = queue.request({ paneKey: 'pb', taskKey: 'AX-2', repoIds: ['landing'] })

    expect(a.position.kind).toBe('holding')
    expect(b.position.kind).toBe('holding')
    expect(b.granted.map((turn) => turn.taskKey)).toEqual(['AX-2'])
  })

  it('makes an overlapping task wait, then grants it when the holder releases', () => {
    const queue = makeQueue()
    queue.request({ paneKey: 'pa', taskKey: 'AX-1', repoIds: ['back', 'admin'] })
    const b = queue.request({ paneKey: 'pb', taskKey: 'AX-2', repoIds: ['back'] })

    expect(b.position).toEqual({
      kind: 'waiting',
      position: 1,
      blockers: [{ taskKey: 'AX-1', repoIds: ['back'], holding: true }]
    })
    expect(b.granted).toEqual([])

    const released = queue.release('pa')
    expect(released.releasedTaskKey).toBe('AX-1')
    expect(released.granted.map((turn) => turn.taskKey)).toEqual(['AX-2'])
    expect(queue.positionOf('pb')?.kind).toBe('holding')
  })

  it('never grants half of what a task needs', () => {
    const queue = makeQueue()
    queue.request({ paneKey: 'pa', taskKey: 'AX-1', repoIds: ['admin'] })
    queue.request({ paneKey: 'pb', taskKey: 'AX-2', repoIds: ['back', 'admin'] })

    expect(queue.snapshot().turns).toEqual([
      { taskKey: 'AX-1', repoIds: ['admin'], paneKeys: ['pa'], grantedAt: 2 }
    ])
  })

  it('never lets a later request overtake an earlier one for the same project', () => {
    const queue = makeQueue()
    queue.request({ paneKey: 'pa', taskKey: 'AX-1', repoIds: ['admin'] })
    queue.request({ paneKey: 'pb', taskKey: 'AX-2', repoIds: ['back', 'admin'] })
    // back is free, but AX-2 asked for it first.
    const c = queue.request({ paneKey: 'pc', taskKey: 'AX-3', repoIds: ['back'] })

    expect(c.position).toEqual({
      kind: 'waiting',
      position: 2,
      blockers: [{ taskKey: 'AX-2', repoIds: ['back'], holding: false }]
    })

    const released = queue.release('pa')
    expect(released.granted.map((turn) => turn.taskKey)).toEqual(['AX-2'])
    expect(queue.positionOf('pc')?.kind).toBe('waiting')
  })

  it('lets a request with no overlap pass a blocked one', () => {
    const queue = makeQueue()
    queue.request({ paneKey: 'pa', taskKey: 'AX-1', repoIds: ['back'] })
    queue.request({ paneKey: 'pb', taskKey: 'AX-2', repoIds: ['back'] })
    const c = queue.request({ paneKey: 'pc', taskKey: 'AX-3', repoIds: ['landing'] })

    expect(c.position.kind).toBe('holding')
  })

  it('shares a turn between panes of the same task and ends it with the last one', () => {
    const queue = makeQueue()
    queue.request({ paneKey: 'pa', taskKey: 'AX-1', repoIds: ['back', 'admin'] })
    const second = queue.request({ paneKey: 'pa2', taskKey: 'AX-1', repoIds: ['admin'] })
    queue.request({ paneKey: 'pb', taskKey: 'AX-2', repoIds: ['back'] })

    expect(second.position.kind).toBe('holding')
    expect(second.granted).toEqual([])
    expect(queue.release('pa').granted).toEqual([])
    expect(queue.release('pa2').granted.map((turn) => turn.taskKey)).toEqual(['AX-2'])
  })

  it('adds free projects to a joined turn and skips ones another task holds', () => {
    const queue = makeQueue()
    queue.request({ paneKey: 'pa', taskKey: 'AX-1', repoIds: ['back'] })
    queue.request({ paneKey: 'pb', taskKey: 'AX-2', repoIds: ['landing'] })
    const joined = queue.request({
      paneKey: 'pa2',
      taskKey: 'AX-1',
      repoIds: ['back', 'admin', 'landing']
    })

    expect(joined.skippedRepoIds).toEqual(['landing'])
    expect(joined.granted.map((turn) => turn.repoIds)).toEqual([['back', 'admin']])
  })

  it('keeps the place in line when a waiting pane asks again', () => {
    const queue = makeQueue()
    queue.request({ paneKey: 'pa', taskKey: 'AX-1', repoIds: ['back'] })
    queue.request({ paneKey: 'pb', taskKey: 'AX-2', repoIds: ['back'] })
    queue.request({ paneKey: 'pc', taskKey: 'AX-3', repoIds: ['back'] })
    const again = queue.request({ paneKey: 'pb', taskKey: 'AX-2', repoIds: ['back'] })

    expect(again.position).toMatchObject({ kind: 'waiting', position: 1 })
    expect(queue.snapshot().waiting.map((waiter) => waiter.paneKey)).toEqual(['pb', 'pc'])
  })

  it('drops a waiter that gives up its place without touching the holder', () => {
    const queue = makeQueue()
    queue.request({ paneKey: 'pa', taskKey: 'AX-1', repoIds: ['back'] })
    queue.request({ paneKey: 'pb', taskKey: 'AX-2', repoIds: ['back'] })

    expect(queue.release('pb')).toEqual({ releasedTaskKey: null, wasWaiting: true, granted: [] })
    expect(queue.paneKeys()).toEqual(['pa'])
  })

  it('gives up the old task when a pane asks for another one', () => {
    const queue = makeQueue()
    queue.request({ paneKey: 'pa', taskKey: 'AX-1', repoIds: ['back'] })
    queue.request({ paneKey: 'pb', taskKey: 'AX-2', repoIds: ['back'] })
    const moved = queue.request({ paneKey: 'pa', taskKey: 'AX-3', repoIds: ['landing'] })

    expect(moved.position.kind).toBe('holding')
    expect(moved.granted.map((turn) => turn.taskKey).sort()).toEqual(['AX-2', 'AX-3'])
  })
})
