import { defineFixture } from '../../../component-fixtures/component-fixture'
import { createProjectGroup } from '../../../../../shared/project-groups'
import type {
  SpotlightAgentPausedRow,
  SpotlightAgentStatus,
  SpotlightAgentTurnRow,
  SpotlightAgentWaitingRow,
  SpotlightResumeAccountPick
} from '../../../../../shared/spotlight-agent-turn'
import { TestQueueButton } from './TestQueueButton'

const MINUTE = 60_000
const NOW = Date.now()

const arrecife = createProjectGroup({ name: 'Arrecife', createdFrom: 'manual', tabOrder: 0 })
const ag = createProjectGroup({ name: 'AG', createdFrom: 'manual', tabOrder: 1 })
const action = createProjectGroup({ name: 'Action', createdFrom: 'manual', tabOrder: 2 })
const projectGroups = [arrecife, ag, action]

function orcaTurn(quietMinutes: number): SpotlightAgentTurnRow {
  return {
    taskKey: 'queue-tester',
    repoNames: ['orca'],
    panes: 1,
    grantedAt: NOW - quietMinutes * MINUTE,
    paneKeys: ['fixture-tab-a:leaf-1'],
    laneKey: arrecife.id
  }
}

const WAITING: SpotlightAgentWaitingRow[] = [
  {
    taskKey: 'AG-12',
    repoNames: ['arctic-grey'],
    since: NOW - 9 * MINUTE,
    paneKey: 'fixture-tab-b:leaf-1',
    laneKey: ag.id
  },
  {
    taskKey: 'AX-3448',
    repoNames: ['action-black'],
    since: NOW - 2 * MINUTE,
    paneKey: 'fixture-tab-c:leaf-1',
    laneKey: action.id
  }
]

const PAUSED: SpotlightAgentPausedRow = {
  paneKey: 'fixture-tab-d:leaf-1',
  taskKey: 'expenses-logs',
  repoNames: ['expenses-logs'],
  laneKey: arrecife.id,
  since: NOW - 40 * MINUTE,
  reason: 'limit',
  pausedAt: NOW - 5 * MINUTE
}

function board(parts: Partial<SpotlightAgentStatus>): SpotlightAgentStatus {
  return { cap: 2, turns: [], waiting: [], paused: [], lit: [], ...parts }
}

function answerPick(pick: SpotlightResumeAccountPick): () => void {
  return () => {
    window.api.spotlight.pickResumeAccount = async () => pick
  }
}

function backAtTwentyToFive(): number {
  const at = new Date(NOW)
  at.setHours(16, 40, 0, 0)
  return at.getTime()
}

// The flask sits at the bottom right of the sidebar footer and opens its popover upward.
function Footer(): React.JSX.Element {
  return (
    <div className="flex items-end justify-end p-2" style={{ height: 380 }}>
      <TestQueueButton />
    </div>
  )
}

const WIDTH = 320

function openPopover(frame: HTMLElement): void {
  frame.querySelector<HTMLButtonElement>('[data-test-queue-trigger]')?.click()
}

export const empty = defineFixture({
  width: WIDTH,
  store: { projectGroups, spotlightTurns: board({}) },
  render: () => <Footer />,
  interact: openPopover
})

export const testingAndWaiting = defineFixture({
  width: WIDTH,
  store: { projectGroups, spotlightTurns: board({ turns: [orcaTurn(3)], waiting: WAITING }) },
  render: () => <Footer />,
  interact: openPopover
})

export const paused = defineFixture({
  width: WIDTH,
  store: {
    projectGroups,
    spotlightTurns: board({ turns: [orcaTurn(3)], waiting: WAITING.slice(0, 1), paused: [PAUSED] })
  },
  setup: answerPick({ kind: 'account', accountId: 'fixture-personal', label: 'personal' }),
  render: () => <Footer />,
  interact: openPopover
})

export const noAccount = defineFixture({
  width: WIDTH,
  store: { projectGroups, spotlightTurns: board({ paused: [PAUSED] }) },
  setup: answerPick({ kind: 'none', returnsAt: backAtTwentyToFive() }),
  render: () => <Footer />,
  interact: openPopover
})

export const idle = defineFixture({
  width: WIDTH,
  store: { projectGroups, spotlightTurns: board({ turns: [orcaTurn(12)], waiting: WAITING }) },
  render: () => <Footer />,
  interact: openPopover
})
