import React, { useCallback, useMemo, useState } from 'react'
import { Code, Layers, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ShortcutKeyCombo } from '@/components/ShortcutKeyCombo'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { ProjectGroupNameDialog } from './ProjectGroupNameDialog'
import type { SidebarSpaceAttention } from './sidebar-space-attention'
import { listSidebarSpaces } from './sidebar-space-scope'
import { useSidebarSpaceAttention } from './use-sidebar-space-attention'

type SpaceSwitcherButtonProps = {
  label: string
  /** Set only on buttons that select a space; the active one reads as pressed. */
  pressed?: boolean
  /** What needs the user in this space; null for the one being viewed, where the dot is redundant. */
  attention?: SidebarSpaceAttention | null
  /** Key labels for the tooltip chip, shown after the name. */
  shortcutKeys?: string[]
  onClick: () => void
  children: React.ReactNode
}

function getAttentionLabel(attention: SidebarSpaceAttention): string {
  return attention === 'permission'
    ? translate('auto.components.sidebar.SidebarSpaceSwitcher.needsPermission', 'Needs permission')
    : translate('auto.components.sidebar.SidebarSpaceSwitcher.unread', 'Unread')
}

function SpaceSwitcherButton({
  label,
  pressed,
  attention,
  shortcutKeys,
  onClick,
  children
}: SpaceSwitcherButtonProps): React.JSX.Element {
  const accessibleLabel = attention
    ? translate(
        'auto.components.sidebar.SidebarSpaceSwitcher.labelWithState',
        '{{value0}} · {{value1}}',
        {
          value0: label,
          value1: getAttentionLabel(attention)
        }
      )
    : label
  return (
    // Why the outer wrapper: the dot must stay full strength while the icon dims, so it cannot sit
    // inside the span that carries the opacity.
    <span className="relative inline-flex shrink-0">
      {/* Why: the active space is told apart by icon brightness alone (Arc-style, no pill). The
          styling lives on this wrapper because <Button> owns its own color and effects. */}
      <span
        data-active={pressed ? 'true' : undefined}
        className="inline-flex text-muted-foreground opacity-40 transition-opacity hover:opacity-100 has-[:focus-visible]:opacity-100 data-[active=true]:text-foreground data-[active=true]:opacity-100"
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              type="button"
              aria-label={accessibleLabel}
              aria-pressed={pressed}
              onClick={onClick}
            >
              {children}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={4}>
            <span className="flex items-center gap-1.5">
              {accessibleLabel}
              {shortcutKeys && shortcutKeys.length > 0 ? (
                <ShortcutKeyCombo
                  keys={shortcutKeys}
                  className="gap-0.5"
                  keyCapClassName="min-w-0 border-background/20 bg-background/10 px-1 py-0 text-[10px] text-background shadow-none"
                />
              ) : null}
            </span>
          </TooltipContent>
        </Tooltip>
      </span>
      {attention ? (
        <span
          aria-hidden="true"
          data-attention={attention}
          className="pointer-events-none absolute top-0.5 right-0.5 size-1.5 rounded-full ring-2 ring-sidebar data-[attention=permission]:bg-agent-question data-[attention=unread]:bg-foreground"
        />
      ) : null}
    </span>
  )
}

export function SidebarSpaceSwitcher(): React.JSX.Element {
  const projectGroups = useAppStore((state) => state.projectGroups)
  const activeGroupId = useAppStore((state) => state.activeSidebarSpaceGroupId)
  const setActiveGroupId = useAppStore((state) => state.setActiveSidebarSpaceGroupId)
  const createProjectGroup = useAppStore((state) => state.createProjectGroup)
  const attentionBySpaceId = useSidebarSpaceAttention()
  const [newSpaceDialogOpen, setNewSpaceDialogOpen] = useState(false)

  const spaces = useMemo(() => listSidebarSpaces(projectGroups), [projectGroups])
  // Why: mirrors resolveSidebarSpaceScope, which treats a deleted or nested id as All.
  const activeSpaceId = spaces.some((space) => space.id === activeGroupId) ? activeGroupId : null

  const handleCreateSpace = useCallback(
    async (name: string) => {
      const group = await createProjectGroup(name)
      if (group) {
        // Why: All shows the new, empty group header so projects can be moved into it.
        setActiveGroupId(null)
      }
    },
    [createProjectGroup, setActiveGroupId]
  )

  return (
    <div className="flex min-w-0 flex-1 items-center justify-center-safe gap-1 overflow-x-clip px-1">
      {spaces.length > 0 ? (
        <SpaceSwitcherButton
          label={translate('auto.components.sidebar.SidebarSpaceSwitcher.all', 'All')}
          pressed={activeSpaceId === null}
          onClick={() => setActiveGroupId(null)}
        >
          <Layers className="size-3.5" />
        </SpaceSwitcherButton>
      ) : null}
      {spaces.map((space) => (
        <SpaceSwitcherButton
          key={space.id}
          label={space.name}
          pressed={activeSpaceId === space.id}
          attention={activeSpaceId === space.id ? null : (attentionBySpaceId.get(space.id) ?? null)}
          onClick={() => setActiveGroupId(space.id)}
        >
          <Code className="size-3.5" />
        </SpaceSwitcherButton>
      ))}
      <SpaceSwitcherButton
        label={translate('auto.components.sidebar.SidebarSpaceSwitcher.newSpace', 'New space')}
        onClick={() => setNewSpaceDialogOpen(true)}
      >
        <Plus className="size-3.5" />
      </SpaceSwitcherButton>
      <ProjectGroupNameDialog
        open={newSpaceDialogOpen}
        title={translate('auto.components.sidebar.SidebarSpaceSwitcher.newSpaceTitle', 'New Space')}
        description={translate(
          'auto.components.sidebar.SidebarSpaceSwitcher.newSpaceDescription',
          'Creates a project group you can switch to from the bottom bar.'
        )}
        initialName=""
        confirmLabel={translate('auto.components.sidebar.SidebarSpaceSwitcher.create', 'Create')}
        onOpenChange={setNewSpaceDialogOpen}
        onSubmit={handleCreateSpace}
      />
    </div>
  )
}
