import { CircleX, FolderTree, List, Pin, Server, Ticket, TicketSlash } from 'lucide-react'
import type React from 'react'
import { translate } from '@/i18n/i18n'
import type { Translate } from '@/i18n/use-translate'
import type { PRGroupKey } from '../../../../../../shared/workspace-view/workspace-pr-groups'
import type {
  GroupHeaderRow,
  SidebarHeaderIcon,
  TaskSectionInfo
} from '../../../../../../shared/sidebar-list/row-types'
import type { WorkspaceStatusDefinition } from '../../../../../../shared/worktree/types'
import {
  ConductorDoneIcon,
  ConductorProgressIcon,
  ConductorReviewIcon
} from '../../workspace-status/presentation/workspace-status-icons'
import { getWorkspaceStatusVisualMeta } from '../../workspace-status/presentation/workspace-status'

const PR_GROUP_META: Record<
  PRGroupKey,
  {
    label: string
    icon: React.ComponentType<{ className?: string }>
    tone: string
  }
> = {
  done: {
    get label() {
      return translate('auto.components.sidebar.worktree.list.groups.5076efc3d2', 'Done')
    },
    icon: ConductorDoneIcon,
    tone: 'text-workspace-status-done'
  },
  'in-review': {
    get label() {
      return translate('auto.components.sidebar.worktree.list.groups.6798dc7c94', 'In review')
    },
    icon: ConductorReviewIcon,
    tone: 'text-workspace-status-review'
  },
  'in-progress': {
    get label() {
      return translate('auto.components.sidebar.worktree.list.groups.7c2f009786', 'In progress')
    },
    icon: ConductorProgressIcon,
    tone: 'text-workspace-status-progress'
  },
  closed: {
    get label() {
      return translate('auto.components.sidebar.worktree.list.groups.682ed5d551', 'Closed')
    },
    icon: CircleX,
    tone: 'text-zinc-600 dark:text-zinc-300'
  }
}

const PROJECT_GROUP_META = {
  tone: 'text-foreground',
  icon: FolderTree
} as const

const PINNED_GROUP_META = {
  get label() {
    return translate('auto.components.sidebar.worktree.list.groups.4aeefc5996', 'Pinned')
  },
  tone: 'text-foreground',
  icon: Pin
} as const

const ALL_GROUP_META = {
  get label() {
    return translate('auto.components.sidebar.worktree.list.groups.0ed04075b8', 'All')
  },
  tone: 'text-foreground',
  icon: List
} as const

const TASK_GROUP_META = {
  tone: 'text-foreground',
  icon: Ticket
} as const

const NO_TASK_GROUP_META = {
  get label() {
    return translate('auto.components.sidebar.worktree.list.groups.noTask', 'No task')
  },
  tone: 'text-muted-foreground',
  icon: TicketSlash
} as const

const SERVERS_GROUP_META = {
  get label() {
    return translate('auto.components.sidebar.worktree.list.groups.servers', 'Servers')
  },
  tone: 'text-muted-foreground',
  icon: Server
} as const

/** A task header's name: its key, then the linked Jira title when one is known. */
function getTaskSectionHeaderLabel(task: TaskSectionInfo): string | undefined {
  if (!task.taskKey) {
    return undefined
  }
  if (!task.title) {
    return task.taskKey
  }
  return translate(
    'auto.components.sidebar.worktree.list.groups.taskWithTitle',
    '{{value0}} · {{value1}}',
    {
      value0: task.taskKey,
      value1: task.title
    }
  )
}

type SidebarHeaderVisual = {
  icon: React.ComponentType<{ className?: string }>
  tone: string
  /** Set for headers the builder leaves unnamed: Pinned, All, the PR lanes, No task and Servers. */
  label?: string
}

/** What the window draws for a header's icon key; read at paint so labels follow the locale. */
export function getSidebarHeaderVisual(
  icon: SidebarHeaderIcon,
  workspaceStatuses: readonly WorkspaceStatusDefinition[],
  t?: Translate
): SidebarHeaderVisual {
  switch (icon.kind) {
    case 'pinned':
      return PINNED_GROUP_META
    case 'all':
      return ALL_GROUP_META
    case 'project':
      return PROJECT_GROUP_META
    case 'pr-status':
      return PR_GROUP_META[icon.prGroup]
    case 'workspace-status': {
      const { icon: statusIcon, tone } = getWorkspaceStatusVisualMeta(
        workspaceStatuses.find((status) => status.id === icon.status) ?? icon.status,
        t
      )
      return { icon: statusIcon, tone }
    }
    case 'task':
      return TASK_GROUP_META
    case 'no-task':
      return NO_TASK_GROUP_META
    case 'servers':
      return SERVERS_GROUP_META
  }
}

/** The name a header shows: a task's key and title, else the builder's data label, else its icon's. */
export function getSidebarHeaderLabel(
  row: Pick<GroupHeaderRow, 'label' | 'task'>,
  visual: SidebarHeaderVisual
): string {
  return (
    (row.task ? getTaskSectionHeaderLabel(row.task) : undefined) ?? row.label ?? visual.label ?? ''
  )
}
