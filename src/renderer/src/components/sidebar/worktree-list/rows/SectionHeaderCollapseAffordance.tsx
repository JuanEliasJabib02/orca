import React from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { handleRepoHeaderCollapseAffordancePointerDown } from './header-event-guards'

/** A section header's collapse chevron; it handles its own click so the header row never toggles twice. */
export function SectionHeaderCollapseAffordance({
  collapsed,
  onToggle
}: {
  collapsed: boolean
  onToggle: (event: React.MouseEvent<HTMLDivElement>) => void
}): React.JSX.Element {
  return (
    <div
      className="flex size-5 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent/70 hover:text-foreground"
      data-repo-header-collapse-affordance=""
      aria-hidden
      onPointerDown={handleRepoHeaderCollapseAffordancePointerDown}
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        onToggle(event)
      }}
    >
      <ChevronDown className={cn('size-3.5 transition-transform', collapsed && '-rotate-90')} />
    </div>
  )
}
