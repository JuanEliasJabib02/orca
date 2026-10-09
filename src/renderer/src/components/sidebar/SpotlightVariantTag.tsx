import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'
import { chooseSpotlightVariant } from '@/lib/spotlight-server-autostart'
import { formatSpotlightVariant } from '../../../../shared/spotlight-server-variant'

// Why: the tag lives inside the clickable workspace row, and the menu's portal still bubbles React
// events to it; neither may activate the workspace.
function stopRowEvent(event: React.SyntheticEvent): void {
  event.stopPropagation()
}

/** The variant (e.g. `DO`) the holder row's Spotlight server runs; its menu switches it, which
 *  restarts only this repo's server. Shown only by the holder row of a repo with variants. */
export function SpotlightVariantTag({
  repoId,
  worktreeId,
  variants,
  variant
}: {
  repoId: string
  worktreeId: string
  variants: readonly string[]
  variant: string | null
}): React.JSX.Element {
  const label = variant
    ? translate(
        'auto.components.sidebar.SpotlightVariantTag.chosen',
        'Spotlight variant: {{variant}}. Click to switch.',
        { variant: formatSpotlightVariant(variant) }
      )
    : translate(
        'auto.components.sidebar.SpotlightVariantTag.unset',
        'No Spotlight variant picked yet. Click to pick one.'
      )

  return (
    <DropdownMenu modal={false}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              data-spotlight-variant-tag=""
              data-workspace-board-preserve-open=""
              aria-label={label}
              onPointerDown={stopRowEvent}
              onClick={stopRowEvent}
              onKeyDown={stopRowEvent}
              className="inline-flex h-4 shrink-0 items-center rounded border border-border px-1 text-[10px] font-semibold uppercase leading-none tracking-wider text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground focus-visible:bg-accent/60 focus-visible:text-foreground data-[state=open]:bg-accent/60 data-[state=open]:text-foreground"
            >
              {variant ? formatSpotlightVariant(variant) : '?'}
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="right" sideOffset={8}>
          {label}
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent
        align="end"
        side="bottom"
        sideOffset={6}
        className="w-24"
        data-workspace-board-preserve-open=""
        onPointerDown={stopRowEvent}
        onMouseDown={stopRowEvent}
        onClick={stopRowEvent}
        onKeyDown={stopRowEvent}
      >
        <DropdownMenuRadioGroup value={variant ?? ''}>
          {variants.map((option) => (
            <DropdownMenuRadioItem
              key={option}
              value={option}
              onSelect={() => {
                if (option !== variant) {
                  void chooseSpotlightVariant({ repoId, worktreeId, variant: option })
                }
              }}
            >
              {formatSpotlightVariant(option)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
