import React from 'react'
import { cn } from '@/lib/utils'
import type { WorktreeCardController } from '../controller/use-worktree-card-controller'
import { WorktreeCardProjectLabel } from '../../worktree-card-project-label'
import { cardElement } from './card-template-compiler'

const part = cardElement<WorktreeCardController>

function projectLabel(props: Readonly<Record<string, unknown>>): React.ReactNode {
  if (typeof props.label !== 'string' || props.label.length === 0) {
    return null
  }
  return (
    <WorktreeCardProjectLabel
      label={props.label}
      tooltipEnabled={props.tooltip !== false}
      className={
        props.line === true
          ? // Why: invisible, not unmounted, while renaming so the row keeps its measured height.
            cn('-mt-1', props.invisible === true && 'invisible')
          : 'max-w-[45%]'
      }
    />
  )
}

export const CARD_PROJECT_PARTS = {
  /** `line` gives the name its own row under the title; otherwise it sits in the meta row. */
  ProjectLabel: part(['label', 'line', 'invisible', 'tooltip'], projectLabel)
}
