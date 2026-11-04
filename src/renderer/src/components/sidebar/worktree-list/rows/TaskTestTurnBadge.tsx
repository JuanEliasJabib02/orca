import React from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useAppStore } from '@/store'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import { useUiLanguageRevision } from '@/i18n/use-ui-language-revision'
import {
  testQueueTaskStanding,
  type TestQueueTaskStanding
} from '../../test-queue/test-queue-board'

function standingLabel(standing: TestQueueTaskStanding): string {
  if (standing.kind === 'testing') {
    return translate('auto.components.sidebar.TaskTestTurnBadge.testing', 'Testing')
  }
  if (standing.kind === 'waiting') {
    return translate('auto.components.sidebar.TaskTestTurnBadge.waiting', 'Queued #{{position}}', {
      position: standing.position
    })
  }
  return translate('auto.components.sidebar.TaskTestTurnBadge.paused', 'Paused')
}

/** Where a task stands in the test queue: testing, its place in line, or paused. */
export function TaskTestTurnBadge({
  taskKey
}: {
  taskKey: string | null
}): React.JSX.Element | null {
  useUiLanguageRevision()
  // Why useShallow: each read builds a fresh object; re-render only when this task's place changes.
  const standing = useAppStore(
    useShallow((s) => (taskKey === null ? null : testQueueTaskStanding(s.spotlightTurns, taskKey)))
  )

  if (!standing) {
    return null
  }

  return (
    <Badge
      variant={standing.kind === 'testing' ? 'secondary' : 'outline'}
      data-task-test-turn={standing.kind}
      className={cn(
        'h-4 px-1.5 py-0 text-3xs leading-none',
        standing.kind !== 'testing' && 'text-muted-foreground'
      )}
    >
      {standingLabel(standing)}
    </Badge>
  )
}
