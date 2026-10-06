import React, { useCallback, useMemo, useState } from 'react'
import { Code, Layers, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ShortcutKeyCombo } from '@/components/ShortcutKeyCombo'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { ProjectGroupNameDialog } from './ProjectGroupNameDialog'
import { listSidebarSpaces } from './sidebar-space-scope'

type SpaceSwitcherButtonProps = {
  label: string
  /** Set only on buttons that select a space; the active one reads as pressed. */
  pressed?: boolean
  /** Key labels for the tooltip chip, shown after the name. */
  shortcutKeys?: string[]
  onClick: () => void
  children: React.ReactNode
}

function SpaceSwitcherButton({
  label,
  pressed,
  shortcutKeys,
  onClick,
  children
}: SpaceSwitcherButtonProps): React.JSX.Element {
  return (
    // Why: the active space is told apart by icon brightness alone (Arc-style, no pill). The
    // styling lives on this wrapper because <Button> owns its own color and effects.
    <span
      data-active={pressed ? 'true' : undefined}
      className="inline-flex shrink-0 text-muted-foreground opacity-40 transition-opacity hover:opacity-100 has-[:focus-visible]:opacity-100 data-[active=true]:text-foreground data-[active=true]:opacity-100"
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon-xs"
            type="button"
            aria-label={label}
            aria-pressed={pressed}
            onClick={onClick}
          >
            {children}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top" sideOffset={4}>
          <span className="flex items-center gap-1.5">
            {label}
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
  )
}

export function SidebarSpaceSwitcher(): React.JSX.Element {
  const projectGroups = useAppStore((state) => state.projectGroups)
  const activeGroupId = useAppStore((state) => state.activeSidebarSpaceGroupId)
  const setActiveGroupId = useAppStore((state) => state.setActiveSidebarSpaceGroupId)
  const createProjectGroup = useAppStore((state) => state.createProjectGroup)
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
