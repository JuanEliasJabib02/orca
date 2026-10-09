import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { formatSpotlightVariant } from '../../../../shared/spotlight-server-variant'
import { Button } from '../ui/button'

function promptToastId(repoId: string): string {
  return `spotlight-variant:${repoId}`
}

function SpotlightVariantPromptBody({
  candidates,
  onPick
}: {
  candidates: readonly string[]
  onPick: (variant: string) => void
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-popover-foreground/80">
        {translate(
          'auto.components.sidebar.SpotlightVariantPrompt.description',
          'Its Spotlight server starts with the one you pick, and this task keeps it.'
        )}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {candidates.map((variant) => (
          <Button
            key={variant}
            type="button"
            variant="outline"
            size="xs"
            data-spotlight-variant-choice={variant}
            onClick={() => onPick(variant)}
          >
            {formatSpotlightVariant(variant)}
          </Button>
        ))}
      </div>
    </div>
  )
}

/** Asks which variant a repo's Spotlight server runs; nothing starts until one is picked. One per
 *  repo: asking again replaces the previous prompt. */
export function showSpotlightVariantPrompt(args: {
  repoId: string
  projectName: string
  candidates: readonly string[]
  onPick: (variant: string) => void
}): void {
  const id = promptToastId(args.repoId)
  toast.info(
    translate(
      'auto.components.sidebar.SpotlightVariantPrompt.title',
      'Pick a variant for {{project}}',
      { project: args.projectName }
    ),
    {
      id,
      description: (
        <SpotlightVariantPromptBody
          candidates={args.candidates}
          onPick={(variant) => {
            toast.dismiss(id)
            args.onPick(variant)
          }}
        />
      ),
      duration: Infinity,
      dismissible: true
    }
  )
}

/** A variant chosen elsewhere (the row's tag) answers the pending prompt. */
export function dismissSpotlightVariantPrompt(repoId: string): void {
  toast.dismiss(promptToastId(repoId))
}
