import React from 'react'

type TestQueueRowProps = {
  name: string
  /** Projects, space and status, already joined. */
  meta: string
  /** The row's buttons; none for a row that needs nothing from the user. */
  actions?: React.ReactNode
}

/** One task (or paused pane) in the test queue popover. */
export function TestQueueRow({ name, meta, actions }: TestQueueRowProps): React.JSX.Element {
  return (
    <div data-test-queue-row="" className="rounded-md px-2 py-1.5">
      <div data-test-queue-row-name="" className="truncate text-xs font-medium text-foreground">
        {name}
      </div>
      {meta ? (
        <div data-test-queue-row-meta="" className="truncate text-2xs text-muted-foreground">
          {meta}
        </div>
      ) : null}
      {actions ? <div className="mt-1.5 flex flex-wrap items-center gap-1.5">{actions}</div> : null}
    </div>
  )
}
