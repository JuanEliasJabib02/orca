# Sidebar spaces (Arc-style)

Orca Pro Max only. Switch between work contexts from the sidebar's bottom bar, like
Arc's spaces.

## Decisions (Juan, 2026-10-06)

- A space is a **top-level project group**. Nothing new is stored about membership:
  a project lives in one space, and moving it is the existing "Move to group".
- **Organizational only.** Switching a space changes which projects the sidebar (and
  everything that follows the sidebar's filters: board, Cmd+1–9, Cmd+J) shows. It
  never changes the open workspace or terminal.
- **UI:** inside the existing footer row (`SidebarToolbar.tsx`), between the
  settings/help buttons and reveal/board. "All" icon first, then one identical `<>`
  (lucide `Code`) per top-level group in `tabOrder`, then `+`. Arc's look, kept simple:
  the active icon is full foreground (white in dark mode), the rest are the same icon
  at low opacity, with no background or pill. The tooltip shows the group name and its
  key. The group header in the list tells you where you are.
- **Keys:** F1/F2/F3 switch to spaces 1/2/3. Juan's order: Action Black, Personal,
  Arctic Grey. Remappable like any Orca keybinding.
- **Badge** on inactive spaces only: orange = an agent there is waiting for
  permission or input. Plain dot = something finished that you haven't seen (the
  same unread state as the sidebar and Dock).
- Ungrouped projects show only in "All". Nested groups stay sections inside their
  top-level space.

## Tasks

- [x] **1. Active space state + sidebar scope**
  - Persist `activeSidebarSpaceGroupId: string | null` through the direct-setter
    pattern used by `setupGuideSidebarDismissed`: the `PersistedUIState` field, the
    zod schema in `rpc-contract/client-ui-params.ts`, the hydration, and the slice
    action.
  - Add a pure `sidebar-space-scope.ts` that resolves the active group's subtree
    into repo ids, group ids and folder workspace ids. A missing or deleted group
    resolves to "All".
  - Apply that scope in `useSidebarHostVisibleScope` (repos, groups, folder
    workspaces), in `computeVisibleWorktrees` (a new optional option, fed by
    `buildVisibleWorktreeOptionsFromState` and `useVisibleSidebarWorktrees`), and in
    the board's visible ids.
  - Check: unit tests for the scope and the filtering, `pnpm tc`, and
    `pnpm run check:code-quality:changed`.
  - Done: 11 test files / 175 tests pass, `pnpm tc` and oxlint clean. The gate's 60
    findings are all in earlier fork files. Also narrows the Cmd+1–9 order
    (`rendered-sidebar-worktree-order.ts`). An active group that gets nested
    resolves to All. Commit `456930b959`.
- [x] **2. Space switcher in the footer**
  - `SidebarSpaceSwitcher.tsx` inside `SidebarToolbar`: All, one `<>` per space,
    and `+`. `+` opens the existing group name dialog, creates a top-level group,
    and activates it.
  - Check: component test, `pnpm tc`, and the design-system gate.
  - Done: 11 switcher tests plus the toolbar and sidebar tests pass, and `pnpm tc` and
    oxlint are clean. The color and opacity live on a span wrapper, because
    `shadcn/no-restyle` rejects them on `<Button>`. `+` leaves you on All so the new
    empty group is visible. A failed create is silent, like the other
    `createProjectGroup` callers.
- [ ] **3. F1/F2/F3 keybindings**
  - Three global keybinding definitions with `allowBareKeybindings`, wired to set
    the active space. The tooltips show the effective binding label.
  - Check: keybinding tests and `pnpm tc`.
- [ ] **4. Attention badge per space**
  - A pure rollup from live agent status (`permission`) and unread
    (`isUnread` + `unreadTerminalTabs`) to group ids, rendered as a dot on
    inactive spaces.
  - Check: unit tests for the rollup, a component test, and `pnpm tc`.
- [ ] **5. Reveal follows the space**
  - When ⌖ is clicked or `revealWorkspaceFilters` runs for a workspace outside the
    active space, switch to that workspace's space, or to "All" if it has none.
  - Check: unit tests and `pnpm tc`.
- [ ] **6. New projects join the active space**
  - A project added while a space is active goes into that group.
  - Check: unit test and `pnpm tc`.
