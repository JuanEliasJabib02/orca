import React from 'react'
import { Check, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { RepoBadgeMark } from '@/components/repo/RepoBadgeLabel'
import { translate } from '@/i18n/i18n'
import type { TuiAgent } from '../../../../shared/tui-agent'
import { agentSupportsAddDir } from '../../../../shared/agent-add-dir-args'
import type { ComposerCompanionRepos } from './use-composer-companion-repos'

type ComposerCompanionReposFieldProps = {
  companions: ComposerCompanionRepos
  quickAgent: TuiAgent | null
  disabled?: boolean
}

/**
 * "Also create in": toggle chips for the repos that get the same branch next to the primary.
 * The access checkbox only shows when its `--add-dir` grant would actually reach the agent.
 */
export function ComposerCompanionReposField({
  companions,
  quickAgent,
  disabled = false
}: ComposerCompanionReposFieldProps): React.JSX.Element | null {
  const labelId = React.useId()
  const accessCheckboxId = React.useId()
  if (companions.candidates.length === 0) {
    return null
  }
  const selected = new Set(companions.selectedIds)
  const showAgentAccess = selected.size > 0 && agentSupportsAddDir(quickAgent)
  return (
    <fieldset disabled={disabled} className="min-w-0 space-y-1.5">
      <div id={labelId} className="text-xs font-medium text-muted-foreground">
        {translate(
          'auto.components.new.workspace.ComposerCompanionReposField.label',
          'Also create in'
        )}
      </div>
      <div role="group" aria-labelledby={labelId} className="flex flex-wrap gap-1.5">
        {companions.candidates.map((repo) => {
          const isSelected = selected.has(repo.id)
          return (
            <Button
              key={repo.id}
              type="button"
              size="xs"
              variant={isSelected ? 'secondary' : 'outline'}
              aria-pressed={isSelected}
              onClick={() => companions.toggle(repo.id)}
              className="max-w-full"
            >
              {isSelected ? <Check /> : <Plus />}
              <RepoBadgeMark color={repo.badgeColor} />
              <span className="truncate">{repo.displayName}</span>
            </Button>
          )
        })}
      </div>
      {showAgentAccess ? (
        <div className="flex items-center gap-2 pt-0.5">
          <Checkbox
            id={accessCheckboxId}
            checked={companions.grantAgentAccess}
            onCheckedChange={(checked) => companions.setGrantAgentAccess(checked === true)}
          />
          <label htmlFor={accessCheckboxId} className="text-xs text-muted-foreground">
            {translate(
              'auto.components.new.workspace.ComposerCompanionReposField.agentAccess',
              'Give the agent access to these worktrees'
            )}
          </label>
        </div>
      ) : null}
    </fieldset>
  )
}
