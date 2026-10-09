# Projects filter per space + Workspace board by task (Orca Pro Max)

Two things Juan hit while using spaces (2026-10-07, again 2026-10-09):
- The Projects filter (Workspace options → Projects, and the board's filter popover)
  lists every space's projects, and a pick made in one space hides everything in
  another.
- The Workspace board lists one card per worktree, so a task like AX-3447 shows up as
  six separate cards in In progress.

## Decisions (Juan, 2026-10-09: "arréglalo acá por favor")

- **Projects filter belongs to the active space.**
  - It lists only that space's projects.
  - Picks made in another space don't narrow, count or badge this one.
  - Clear, Select all and "Clear filters" touch only this space's picks.
  - The Agents view keeps its own unscoped filter.
- **Board follows the space's Group by.**
  - **Task:** one card per task with its key, note, Spotlight button and env pill. The
    task's repos are small rows inside the card. Worktrees without a task stay normal
    cards.
  - **Moving a task moves all its worktrees** ("si muevo una tarea todos sus worktrees
    deben pasar"). If they ever disagree (e.g. moved one by one from the sidebar),
    the card sits in the least advanced lane.
  - **Project:** project sub-headers inside each lane.
  - **No grouping:** unchanged.
- One rebuild at the end, carrying round 2 of the Spotlight servers too.

## Tasks

- [ ] **1. Projects filter scoped to the active space** (resumes `wip/space-project-filter` 9f664f73fe; Clear / Select all / Clear filters keep other spaces' picks via `replaceSpaceRepoFilterIds`)
  - Check: `sidebar-space-scope`, `SidebarRepositoryFilterSection`, `SidebarFilter`, `use-active-sidebar-space`, `workspace-options-filter-badge`, `visible-worktrees-space-scope`, `use-visible-workspace-kanban-worktree-ids` tests.
- [ ] **2. Board task cards (Group by Task)**: card per task, drag moves every worktree, mixed statuses → least advanced lane
  - Check: unit tests for the board items (grouping, lane placement, counts, search) and the drag moving all of a task's worktrees; component test for the task card.
- [ ] **3. Board project sections (Group by Project)**: sub-headers per project inside each lane
  - Check: unit tests for the section rows and that drag/selection skip headers.

## Verification rule

Nothing heavy while building (Juan's CPU). When the code is done, ask Juan, then run only
the listed test files, `oxlint` on the changed files and `pnpm tc` once. Commit each task
after its check. Rebuild only when Juan asks.
