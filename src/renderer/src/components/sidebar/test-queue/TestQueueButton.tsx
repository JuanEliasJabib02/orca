import React, { useMemo, useState } from 'react'
import { FlaskConical } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store'
import { buildTestQueueBoardView } from './test-queue-board'
import { TestQueuePopover } from './TestQueuePopover'

// Why no statuses, names or clock: the footer draws only the count; statuses move per tool call.
const NO_AGENT_STATUSES = {}
const noTaskName = (): null => null

/** The sidebar footer's test queue: a flask and how many tasks test or wait; opens the queue. */
export function TestQueueButton(): React.JSX.Element {
  useTranslation()
  const [open, setOpen] = useState(false)
  const board = useAppStore((s) => s.spotlightTurns)
  const { count, pausedCount } = useMemo(() => {
    const view = buildTestQueueBoardView({
      board,
      agentStatusByPaneKey: NO_AGENT_STATUSES,
      taskName: noTaskName,
      now: 0
    })
    return { count: view.count, pausedCount: view.paused.length }
  }, [board])
  const title = translate('auto.components.sidebar.TestQueue.title', 'Test queue')
  // Paused tasks never count, but they keep the flask lit: they wait for a Continuar.
  const quiet = count === 0 && pausedCount === 0

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip open={open ? false : undefined}>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size={count > 0 ? 'xs' : 'icon-xs'}
              type="button"
              aria-label={title}
              data-test-queue-trigger=""
              className={cn('text-muted-foreground', quiet && 'opacity-40 hover:opacity-100')}
            >
              <FlaskConical className="size-3.5" />
              {count > 0 ? <span className="tabular-nums">{count}</span> : null}
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="top" sideOffset={4}>
          {count === 0
            ? translate('auto.components.sidebar.TestQueue.nobodyTesting', 'Nobody is testing')
            : title}
        </TooltipContent>
      </Tooltip>
      <PopoverContent
        side="top"
        align="end"
        sideOffset={6}
        className="w-72 p-0"
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <TestQueuePopover />
      </PopoverContent>
    </Popover>
  )
}
