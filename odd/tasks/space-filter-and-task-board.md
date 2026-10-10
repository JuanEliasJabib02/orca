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
    deben pasar"): every worktree of that task in the active space, primaries excluded,
    even ones a filter hides. If they ever disagree (e.g. moved one by one from the
    sidebar), the card sits in the least advanced lane.
  - A task with one worktree is still a task card (same rule as the sidebar). Lane
    counts count cards.
  - **Project:** project sub-headers inside each lane.
  - **No grouping:** unchanged.
- **Every named workspace is a task** (Juan, 2026-10-09: "cada worktree que se crea se
  crea con un nombre y eso sería una tarea"). A worktree without a ticket is a task
  named by its branch, even alone in one repo; shared branch names still merge across
  repos. Task actions (delete, Spotlight, move) only reach the active space.
- **"No task" becomes "Servers"** in Group by Task: one row per project of the space,
  showing only its root (main checkout), never hidden by filters ("sobre todo me toca
  salir de mi filtro"). Clicking opens the root on its Spotlight terminal, so Juan can
  read the log, restart or stop the server himself. Leftovers without a name (folders)
  keep a "No task" section that shows only when non-empty.
- One rebuild at the end, carrying round 2 of the Spotlight servers too.

## Tasks

- [x] **1. Projects filter scoped to the active space** (`147a9205a8`; resumes `wip/space-project-filter` 9f664f73fe; Clear / Select all / Clear filters keep other spaces' picks via `replaceSpaceRepoFilterIds`)
  - Check: `sidebar-space-scope`, `SidebarRepositoryFilterSection`, `SidebarFilter`, `use-active-sidebar-space`, `workspace-options-filter-badge`, `visible-worktrees-space-scope`, `use-visible-workspace-kanban-worktree-ids` tests.
- [x] **2. Board task cards (Group by Task)**: card per task, drag moves every worktree, mixed statuses → least advanced lane (coder opus, `f7620040ea` together with task 3: they share six files' hunks)
  - Check: unit tests for the board items (grouping, lane placement, counts, search) and the drag moving all of a task's worktrees; component test for the task card.
- [x] **3. Board project sections (Group by Project)**: sub-headers per project inside each lane (same commit as task 2)
  - Check: unit tests for the section rows and that drag/selection skip headers.

- [x] **4. Every named workspace is a task**: branch-name key even for a single worktree; task actions scoped to the active space (coder opus, `4994f490ff` with task 5)
  - Check: task-key tests (single worktree, shared merge, main/archived/reserved), delete/Spotlight targets scoped to the space.
- [x] **5. "Servers" section with the project roots** in Group by Task, filter-proof, click opens the root's Spotlight terminal (`4994f490ff`; test harness fixes `2cfbbd7570`)
  - Check: section composition (every root of the space despite filters, no other worktrees, last), "No task" only when non-empty, click target.

## Verification (2026-10-09)

47 test files of the changed areas (547 tests) pass and `pnpm tc` is clean.

`/code-review-strict` over `cc459632de..97f13b201d` (opus + sonnet), two rounds: ESCALATED only
on J-001 (cross-space Group by in the Servers-root skip), fixed right after with the user's OK.
Fixed: the Projects-filter reveal and Cmd+J seed read the space's picks (the target space's on a
jump); Servers roots never touch filters on any activation path; task-card row keys; a task note
is cleared only when no worktree of the task is left in any space; the env restart reaches every
space again; provisioned VM roots stay in their task. Final check: 70 test files (770 tests) and
`pnpm tc` clean.

## Verification rule

Nothing heavy while building (Juan's CPU). When the code is done, ask Juan, then run only
the listed test files, `oxlint` on the changed files and `pnpm tc` once. Commit each task
after its check. Rebuild only when Juan asks.
