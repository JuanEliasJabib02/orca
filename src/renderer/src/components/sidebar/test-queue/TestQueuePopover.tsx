import React, { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { useNow } from '@/hooks/use-now'
import { translate } from '@/i18n/i18n'
import { uiDateTimeFormat } from '@/i18n/ui-intl-formatters'
import { useAppStore } from '@/store'
import { getIndexedAllWorktrees } from '@/store/slices/worktrees/listing/worktree-catalog-index'
import { selectWorktreesByRepo } from '@/store/workspaces/catalog/workspace-record-fields'
import { findTaskTitle } from '../../../../../shared/sidebar-list/task-sections'
import type {
  SpotlightAgentPauseReason,
  SpotlightResumeAccountPick
} from '../../../../../shared/spotlight-agent-turn'
import {
  buildTestQueueBoardView,
  type TestQueuePausedRow,
  type TestQueueTestingRow,
  type TestQueueWaitingRow
} from './test-queue-board'
import { TestQueueRow } from './TestQueueRow'
import { useResumeAccountPick } from './use-resume-account-pick'

const MINUTE_MS = 60_000
const RETURN_TIME_FORMAT: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit' }

type PendingAction = 'continue' | 'release'

function continueTestTask(paneKey: string): Promise<unknown> {
  return useAppStore.getState().continueTestTask(paneKey, { auto: false })
}

/** `Soltar turno`: every pane of the task gives the turn back, so the next task gets it. */
async function releaseTurnPanes(paneKeys: readonly string[]): Promise<void> {
  await Promise.all(paneKeys.map((paneKey) => window.api.spotlight.releaseTurn(paneKey)))
}

/** `orca · Arrecife · esperando 9 min`: projects, space and status, skipping what is unknown. */
function rowMeta(
  taskName: string,
  repoNames: readonly string[],
  spaceName: string | null,
  status: string | null
): string {
  const repos = repoNames.join(', ')
  // Why: a task named after its only project would print the name twice.
  const showRepos = repos !== '' && repos.toLowerCase() !== taskName.toLowerCase()
  return [showRepos ? repos : null, spaceName, status]
    .filter((part): part is string => Boolean(part))
    .join(' · ')
}

function idleLabel(minutes: number): string {
  return translate('auto.components.sidebar.TestQueue.idleFor', 'no activity for {{count}} min', {
    count: minutes,
    defaultValue_one: 'no activity for {{count}} min'
  })
}

function waitingLabel(minutes: number): string | null {
  // Why: under a minute the section title already says it waits.
  if (minutes < 1) {
    return null
  }
  return translate('auto.components.sidebar.TestQueue.waitingFor', 'waiting {{count}} min', {
    count: minutes,
    defaultValue_one: 'waiting {{count}} min'
  })
}

function pauseReasonLabel(reason: SpotlightAgentPauseReason): string {
  return reason === 'limit'
    ? translate('auto.components.sidebar.TestQueue.outOfLimit', 'ran out of limit')
    : translate('auto.components.sidebar.TestQueue.stoppedOnError', 'stopped on an error')
}

function continueLabel(): string {
  return translate('auto.components.sidebar.TestQueue.continue', 'Continue')
}

function resumingLabel(): string {
  return translate('auto.components.sidebar.TestQueue.resuming', 'Resuming…')
}

/** A paused row's Continuar names the account it will use, or waits for one with limit. */
function pausedContinue(pick: SpotlightResumeAccountPick | null): {
  label: string
  disabled: boolean
} {
  if (pick === null) {
    return { label: continueLabel(), disabled: false }
  }
  if (pick.kind === 'account') {
    return {
      label: translate(
        'auto.components.sidebar.TestQueue.continueWith',
        'Continue with {{account}}',
        { account: pick.label }
      ),
      disabled: false
    }
  }
  if (pick.returnsAt === null) {
    return { label: continueLabel(), disabled: true }
  }
  return {
    label: translate('auto.components.sidebar.TestQueue.backAt', 'Back at {{time}}', {
      time: uiDateTimeFormat(RETURN_TIME_FORMAT).format(pick.returnsAt)
    }),
    disabled: true
  }
}

function TestQueueSection({
  kind,
  title,
  rows
}: {
  kind: 'testing' | 'waiting' | 'paused'
  title: string
  rows: React.ReactNode[]
}): React.JSX.Element | null {
  if (rows.length === 0) {
    return null
  }
  return (
    <section data-test-queue-section={kind} className="py-1">
      <h3 className="px-2 pb-0.5 text-2xs font-semibold text-muted-foreground">{title}</h3>
      {rows}
    </section>
  )
}

/** The test queue: who tests, who waits, who is paused, and the buttons that unstick them. */
export function TestQueuePopover(): React.JSX.Element {
  useTranslation()
  const board = useAppStore((s) => s.spotlightTurns)
  const agentStatusByPaneKey = useAppStore((s) => s.agentStatusByPaneKey)
  const worktrees = useAppStore((s) => getIndexedAllWorktrees(selectWorktreesByRepo(s)))
  const projectGroups = useAppStore((s) => s.projectGroups)
  const now = useNow(MINUTE_MS)
  const view = useMemo(
    () =>
      buildTestQueueBoardView({
        board,
        agentStatusByPaneKey,
        taskName: (taskKey) => findTaskTitle(taskKey, worktrees),
        now
      }),
    [board, agentStatusByPaneKey, worktrees, now]
  )
  const pick = useResumeAccountPick(view.paused.map((row) => row.paneKey))
  const [pending, setPending] = useState<ReadonlyMap<string, PendingAction>>(() => new Map())

  const spaceName = (laneKey: string | undefined): string | null =>
    projectGroups.find((group) => group.id === laneKey)?.name ?? null

  const runPending = (
    rowKey: string,
    action: PendingAction,
    work: () => Promise<unknown>
  ): void => {
    setPending((current) => new Map(current).set(rowKey, action))
    // Why Promise.resolve().then: a synchronous throw must clear the row too.
    void Promise.resolve()
      .then(work)
      .catch((err) => console.error('Test queue action failed:', err))
      .finally(() =>
        setPending((current) => {
          const next = new Map(current)
          next.delete(rowKey)
          return next
        })
      )
  }

  const testingRow = (turn: TestQueueTestingRow): React.JSX.Element => {
    const rowKey = `turn:${turn.taskKey}`
    const paneKeys = turn.paneKeys ?? []
    // The pane that asked last is the one Continuar writes to.
    const targetPaneKey = paneKeys.at(-1)
    const pendingAction = pending.get(rowKey)
    const resuming = turn.resuming === true || pendingAction === 'continue'
    const flagged = turn.idleMinutes !== null || turn.resuming === true
    const actions =
      flagged && targetPaneKey ? (
        <>
          <Button
            type="button"
            variant="secondary"
            size="xs"
            disabled={resuming || pendingAction !== undefined}
            onClick={() => runPending(rowKey, 'continue', () => continueTestTask(targetPaneKey))}
          >
            {resuming ? resumingLabel() : continueLabel()}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            disabled={pendingAction !== undefined}
            onClick={() => runPending(rowKey, 'release', () => releaseTurnPanes(paneKeys))}
          >
            {translate('auto.components.sidebar.TestQueue.releaseTurn', 'Release turn')}
          </Button>
        </>
      ) : null
    return (
      <TestQueueRow
        key={rowKey}
        name={turn.taskName}
        meta={rowMeta(
          turn.taskName,
          turn.repoNames,
          spaceName(turn.laneKey),
          turn.idleMinutes === null ? null : idleLabel(turn.idleMinutes)
        )}
        actions={actions}
      />
    )
  }

  const waitingRow = (row: TestQueueWaitingRow): React.JSX.Element => (
    <TestQueueRow
      key={`waiting:${row.taskKey}`}
      name={row.taskName}
      meta={rowMeta(
        row.taskName,
        row.repoNames,
        spaceName(row.laneKey),
        waitingLabel(Math.floor((now - row.since) / MINUTE_MS))
      )}
    />
  )

  const pausedButton = pausedContinue(pick)
  const pausedRow = (row: TestQueuePausedRow): React.JSX.Element => {
    const rowKey = `paused:${row.paneKey}`
    const resuming = row.resuming === true || pending.has(rowKey)
    return (
      <TestQueueRow
        key={rowKey}
        name={row.taskName}
        meta={rowMeta(
          row.taskName,
          row.repoNames,
          spaceName(row.laneKey),
          pauseReasonLabel(row.reason)
        )}
        actions={
          <Button
            type="button"
            variant="secondary"
            size="xs"
            className="max-w-full"
            disabled={resuming || pausedButton.disabled}
            onClick={() => runPending(rowKey, 'continue', () => continueTestTask(row.paneKey))}
          >
            <span className="truncate">{resuming ? resumingLabel() : pausedButton.label}</span>
          </Button>
        }
      />
    )
  }

  const empty = view.testing.length + view.waiting.length + view.paused.length === 0

  return (
    <div className="flex flex-col">
      <div className="flex items-baseline justify-between gap-2 border-b border-border px-3 py-2">
        <span className="text-sm font-medium text-foreground">
          {translate('auto.components.sidebar.TestQueue.title', 'Test queue')}
        </span>
        {board.cap === undefined ? null : (
          <span className="shrink-0 text-2xs text-muted-foreground">
            {translate(
              'auto.components.sidebar.TestQueue.limit',
              'Limit: {{count}} tasks at a time',
              { count: board.cap, defaultValue_one: 'Limit: {{count}} task at a time' }
            )}
          </span>
        )}
      </div>
      {empty ? (
        <p className="px-3 py-3 text-xs text-muted-foreground">
          {translate('auto.components.sidebar.TestQueue.nobodyTesting', 'Nobody is testing')}
        </p>
      ) : (
        <div className="scrollbar-sleek max-h-80 overflow-y-auto p-1">
          <TestQueueSection
            kind="testing"
            title={translate('auto.components.sidebar.TestQueue.testing', 'Testing')}
            rows={view.testing.map(testingRow)}
          />
          <TestQueueSection
            kind="waiting"
            title={translate('auto.components.sidebar.TestQueue.waiting', 'Queued')}
            rows={view.waiting.map(waitingRow)}
          />
          <TestQueueSection
            kind="paused"
            title={translate('auto.components.sidebar.TestQueue.paused', 'Paused')}
            rows={view.paused.map(pausedRow)}
          />
        </div>
      )}
      {view.paused.length === 0 ? null : (
        <p className="border-t border-border px-3 py-2 text-2xs leading-4 text-pretty text-muted-foreground">
          {pick?.kind === 'none'
            ? translate(
                'auto.components.sidebar.TestQueue.noAccountHint',
                'No account has limit left right now. The button turns on when the first one comes back.'
              )
            : translate(
                'auto.components.sidebar.TestQueue.continueHint',
                'Continue opens its session with the account that has limit left and tells it to pick up where it left off.'
              )}
        </p>
      )}
    </div>
  )
}
