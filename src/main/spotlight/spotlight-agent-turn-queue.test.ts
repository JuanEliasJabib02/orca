import { describe, expect, it } from 'vitest'
import { SpotlightTurnQueue } from './spotlight-agent-turn-queue'

function makeQueue(): SpotlightTurnQueue {
  let clock = 0
  return new SpotlightTurnQueue(() => ++clock)
}

function makeCappedQueue(cap = 2): SpotlightTurnQueue {
  let clock = 0
  return new SpotlightTurnQueue({ now: () => ++clock, cap: () => cap })
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

describe('SpotlightTurnQueue lanes and cap', () => {
  it('grants one task per lane at the same time while under the cap', () => {
    const queue = makeCappedQueue(2)
    const ag = queue.request({ paneKey: 'pa', taskKey: 'AG-1', repoIds: ['shop'], laneKey: 'ag' })
    const ax = queue.request({
      paneKey: 'pb',
      taskKey: 'AX-1',
      repoIds: ['back'],
      laneKey: 'action'
    })

    expect(ag.position.kind).toBe('holding')
    expect(ax.position.kind).toBe('holding')
    expect(queue.snapshot().turns.map((turn) => [turn.taskKey, turn.laneKey])).toEqual([
      ['AG-1', 'ag'],
      ['AX-1', 'action']
    ])
  })

  it('makes a task of a busy lane wait even for other projects, in order', () => {
    const queue = makeCappedQueue(2)
    queue.request({ paneKey: 'pa', taskKey: 'AG-1', repoIds: ['shop'], laneKey: 'ag' })
    const second = queue.request({
      paneKey: 'pb',
      taskKey: 'AG-2',
      repoIds: ['admin'],
      laneKey: 'ag'
    })
    const third = queue.request({
      paneKey: 'pc',
      taskKey: 'AG-3',
      repoIds: ['blog'],
      laneKey: 'ag'
    })

    expect(second.position).toEqual({
      kind: 'waiting',
      position: 1,
      blockers: [{ taskKey: 'AG-1', repoIds: ['shop'], holding: true, reason: 'lane' }]
    })
    expect(third.position).toEqual({
      kind: 'waiting',
      position: 2,
      blockers: [
        { taskKey: 'AG-1', repoIds: ['shop'], holding: true, reason: 'lane' },
        { taskKey: 'AG-2', repoIds: ['admin'], holding: false, reason: 'lane' }
      ]
    })
    expect(queue.release('pa').granted.map((turn) => turn.taskKey)).toEqual(['AG-2'])
  })

  it('makes a third lane wait while the cap is reached and grants it on a release', () => {
    const queue = makeCappedQueue(2)
    queue.request({ paneKey: 'pa', taskKey: 'AG-1', repoIds: ['shop'], laneKey: 'ag' })
    queue.request({ paneKey: 'pb', taskKey: 'AX-1', repoIds: ['back'], laneKey: 'action' })
    const third = queue.request({
      paneKey: 'pc',
      taskKey: 'EX-1',
      repoIds: ['expenses'],
      laneKey: 'arrecife'
    })
    const fourth = queue.request({ paneKey: 'pd', taskKey: 'OPM-1', repoIds: [], laneKey: 'orca' })

    expect(third.position).toEqual({
      kind: 'waiting',
      position: 1,
      blockers: [
        { taskKey: 'AG-1', repoIds: ['shop'], holding: true, reason: 'cap' },
        { taskKey: 'AX-1', repoIds: ['back'], holding: true, reason: 'cap' }
      ]
    })
    expect(fourth.position).toMatchObject({ kind: 'waiting', position: 2 })
    expect(queue.release('pb').granted.map((turn) => turn.taskKey)).toEqual(['EX-1'])
    expect(queue.positionOf('pd')?.kind).toBe('waiting')
  })

  it('reads the cap live, so lowering it holds back the next grant', () => {
    let cap = 2
    let clock = 0
    const queue = new SpotlightTurnQueue({ now: () => ++clock, cap: () => cap })
    queue.request({ paneKey: 'pa', taskKey: 'AG-1', repoIds: ['shop'], laneKey: 'ag' })
    queue.request({ paneKey: 'pb', taskKey: 'AX-1', repoIds: ['back'], laneKey: 'action' })
    queue.request({ paneKey: 'pc', taskKey: 'EX-1', repoIds: ['expenses'], laneKey: 'arrecife' })
    cap = 1

    expect(queue.release('pa').granted).toEqual([])
    expect(queue.release('pb').granted.map((turn) => turn.taskKey)).toEqual(['EX-1'])
  })

  it('lets a lane-blocked waiter keep its projects from a later waiter of another lane', () => {
    const queue = makeCappedQueue(2)
    queue.request({ paneKey: 'pa', taskKey: 'AG-1', repoIds: ['shop'], laneKey: 'ag' })
    queue.request({ paneKey: 'pb', taskKey: 'AG-2', repoIds: ['shared'], laneKey: 'ag' })
    const later = queue.request({
      paneKey: 'pc',
      taskKey: 'AX-1',
      repoIds: ['shared'],
      laneKey: 'action'
    })

    expect(later.position).toEqual({
      kind: 'waiting',
      position: 2,
      blockers: [{ taskKey: 'AG-2', repoIds: ['shared'], holding: false }]
    })
    expect(queue.release('pa').granted.map((turn) => turn.taskKey)).toEqual(['AG-2'])
    expect(queue.positionOf('pc')?.kind).toBe('waiting')
  })

  it('lets a pane of a task holding a turn join it past the cap', () => {
    const queue = makeCappedQueue(1)
    queue.request({ paneKey: 'px', taskKey: 'AX-1', repoIds: ['back'], laneKey: 'action' })
    queue.request({ paneKey: 'pa', taskKey: 'AG-1', repoIds: ['shop'], laneKey: 'ag' })
    queue.request({ paneKey: 'pa2', taskKey: 'AG-1', repoIds: ['admin'], laneKey: 'ag' })

    const released = queue.release('px')
    expect(released.granted.map((turn) => [turn.taskKey, turn.repoIds, turn.paneKeys])).toEqual([
      ['AG-1', ['shop', 'admin'], ['pa', 'pa2']]
    ])
    const third = queue.request({
      paneKey: 'pa3',
      taskKey: 'AG-1',
      repoIds: ['shop'],
      laneKey: 'ag'
    })
    expect(third.position.kind).toBe('holding')
  })

  it('gives a task with no project a slot of its own', () => {
    const queue = makeCappedQueue(1)
    const orca = queue.request({ paneKey: 'po', taskKey: 'OPM-1', repoIds: [], laneKey: 'orca' })
    const ag = queue.request({ paneKey: 'pa', taskKey: 'AG-1', repoIds: ['shop'], laneKey: 'ag' })

    expect(orca.position).toEqual({
      kind: 'holding',
      turn: { taskKey: 'OPM-1', repoIds: [], paneKeys: ['po'], grantedAt: 2, laneKey: 'orca' }
    })
    expect(ag.position).toEqual({
      kind: 'waiting',
      position: 1,
      blockers: [{ taskKey: 'OPM-1', repoIds: [], holding: true, reason: 'cap' }]
    })
    expect(queue.release('po').granted.map((turn) => turn.taskKey)).toEqual(['AG-1'])
  })
})

describe('SpotlightTurnQueue paused panes', () => {
  it('pauses a holder: the next task goes, the pane keeps a place and claims nothing', () => {
    const queue = makeCappedQueue(2)
    queue.request({ paneKey: 'pa', taskKey: 'AG-1', repoIds: ['shop'], laneKey: 'ag' })
    queue.request({ paneKey: 'pb', taskKey: 'AG-2', repoIds: ['shop'], laneKey: 'ag' })

    const paused = queue.pause('pa', { reason: 'limit' })
    expect(paused.pausedTaskKey).toBe('AG-1')
    expect(paused.wasHolding).toBe(true)
    expect(paused.granted.map((turn) => turn.taskKey)).toEqual(['AG-2'])

    const snapshot = queue.snapshot()
    expect(snapshot.waiting).toEqual([])
    expect(snapshot.paused).toEqual([
      {
        paneKey: 'pa',
        taskKey: 'AG-1',
        repoIds: ['shop'],
        laneKey: 'ag',
        since: 4,
        reason: 'limit',
        pausedAt: 4
      }
    ])
    expect(queue.positionOf('pa')).toEqual({
      kind: 'waiting',
      position: 1,
      blockers: [{ taskKey: 'AG-2', repoIds: ['shop'], holding: true }],
      paused: { reason: 'limit', pausedAt: 4 }
    })
    // Why: the killed agent re-publishes its failure; pausing again changes nothing.
    expect(queue.pause('pa', { reason: 'error' })).toEqual({
      pausedTaskKey: null,
      wasHolding: false,
      granted: []
    })
    expect(queue.snapshot().paused.map((entry) => entry.reason)).toEqual(['limit'])
  })

  it('keeps the turn of a two-pane task while its other pane works', () => {
    const queue = makeCappedQueue(2)
    queue.request({ paneKey: 'pa', taskKey: 'AG-1', repoIds: ['shop'], laneKey: 'ag' })
    queue.request({ paneKey: 'pa2', taskKey: 'AG-1', repoIds: ['shop'], laneKey: 'ag' })
    queue.request({ paneKey: 'pb', taskKey: 'AG-2', repoIds: ['admin'], laneKey: 'ag' })

    expect(queue.pause('pa', { reason: 'limit' }).granted).toEqual([])
    expect(queue.snapshot().turns.map((turn) => [turn.taskKey, turn.paneKeys])).toEqual([
      ['AG-1', ['pa2']]
    ])
    expect(queue.release('pa2').granted.map((turn) => turn.taskKey)).toEqual(['AG-2'])
  })

  it('puts a paused holder that asks again first in line for its lane', () => {
    const queue = makeCappedQueue(2)
    queue.request({ paneKey: 'pa', taskKey: 'AG-1', repoIds: ['shop'], laneKey: 'ag' })
    queue.request({ paneKey: 'pb', taskKey: 'AG-2', repoIds: ['admin'], laneKey: 'ag' })
    queue.request({ paneKey: 'pc', taskKey: 'AG-3', repoIds: ['blog'], laneKey: 'ag' })
    queue.pause('pa', { reason: 'limit' })

    const again = queue.request({
      paneKey: 'pa',
      taskKey: 'AG-1',
      repoIds: ['shop'],
      laneKey: 'ag'
    })
    expect(again.position).toEqual({
      kind: 'waiting',
      position: 1,
      blockers: [{ taskKey: 'AG-2', repoIds: ['admin'], holding: true, reason: 'lane' }]
    })
    expect(queue.snapshot().paused).toEqual([])
    expect(queue.release('pb').granted.map((turn) => turn.taskKey)).toEqual(['AG-1'])
    expect(queue.positionOf('pc')?.kind).toBe('waiting')
  })

  it('pauses a waiter in its place, so asking again keeps who is ahead and behind', () => {
    const queue = makeQueue()
    queue.request({ paneKey: 'pa', taskKey: 'AX-1', repoIds: ['admin'] })
    queue.request({ paneKey: 'p0', taskKey: 'AX-0', repoIds: ['admin'] })
    queue.request({ paneKey: 'pb', taskKey: 'AX-2', repoIds: ['admin'] })
    queue.request({ paneKey: 'pc', taskKey: 'AX-3', repoIds: ['admin'] })

    expect(queue.pause('pb', { reason: 'error' })).toEqual({
      pausedTaskKey: 'AX-2',
      wasHolding: false,
      granted: []
    })
    expect(queue.positionOf('pc')).toEqual({
      kind: 'waiting',
      position: 2,
      blockers: [
        { taskKey: 'AX-1', repoIds: ['admin'], holding: true },
        { taskKey: 'AX-0', repoIds: ['admin'], holding: false }
      ]
    })
    queue.request({ paneKey: 'pb', taskKey: 'AX-2', repoIds: ['admin'] })
    expect(queue.release('pa').granted.map((turn) => turn.taskKey)).toEqual(['AX-0'])
    expect(queue.release('p0').granted.map((turn) => turn.taskKey)).toEqual(['AX-2'])
  })

  it('lets later waiters and joining panes take what a paused waiter wanted', () => {
    const queue = makeQueue()
    queue.request({ paneKey: 'pa', taskKey: 'AX-1', repoIds: ['admin'] })
    queue.request({ paneKey: 'pb', taskKey: 'AX-2', repoIds: ['back', 'admin', 'blog'] })
    queue.request({ paneKey: 'pc', taskKey: 'AX-3', repoIds: ['back'] })

    expect(queue.pause('pb', { reason: 'limit' }).granted.map((turn) => turn.taskKey)).toEqual([
      'AX-3'
    ])
    const joined = queue.request({ paneKey: 'pa2', taskKey: 'AX-1', repoIds: ['blog'] })
    expect(joined.skippedRepoIds).toEqual([])
    expect(joined.granted.map((turn) => turn.repoIds)).toEqual([['admin', 'blog']])
  })

  it('drops a paused pane that gives up its place', () => {
    const queue = makeCappedQueue(2)
    queue.request({ paneKey: 'pa', taskKey: 'AG-1', repoIds: ['shop'], laneKey: 'ag' })
    queue.request({ paneKey: 'pb', taskKey: 'AG-2', repoIds: ['admin'], laneKey: 'ag' })
    queue.pause('pa', { reason: 'error' })

    expect(queue.release('pa')).toEqual({ releasedTaskKey: null, wasWaiting: true, granted: [] })
    expect(queue.positionOf('pa')).toBeNull()
    expect(queue.snapshot().paused).toEqual([])
    expect(queue.paneKeys()).toEqual(['pb'])
  })
})
