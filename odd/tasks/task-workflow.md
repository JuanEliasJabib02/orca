# Task workflow on top of spaces (Orca Pro Max)

Juan works one Jira task across several repos (AX-3448 in backend-action,
action-experience, admin-action, reset). Goal: create those worktrees in one step, see
them together, review them together, and never lose track of the space or the project.
Builds on `odd/tasks/sidebar-spaces.md`, on the same branch.

## Decisions (Juan, 2026-10-06)

- **Create worktree dialog:**
  - The project picker lists the active space's projects. Search also finds other
    spaces' projects, in a separate "Other spaces" section.
  - A new "Also create in" multi-select picks the companion repos, filtered the same
    way. The selected Project is the primary: the agent opens only there, with
    `--add-dir` to the companions' real worktree paths.
  - Each repo branches from its own base (develop or main), with the same branch name
    pinned in all of them. The companion selection is remembered per primary repo.
- **Group by → Task:** a new option next to None / Status / PR / Project.
  - A worktree's key comes from the linked Jira item (`linkedWorkItem.jiraIdentifier`)
    first, then the branch, then the display name. Matching is case-, space- and
    underscore-tolerant, so "Ax 3356" and "ax_3356" both become AX-3356. Any
    `ABC-123` key works.
  - Each header shows the key, plus the Jira title when linked, and rolls up its
    agents' status. Worktrees with no key go to a "No task" section at the bottom.
- **Group by is remembered per space.** Sort by stays global.
- **Spotlight the whole task** from the task header:
  - It points each repo's Spotlight at that task's worktree. Repos without Spotlight
    enabled are skipped and marked.
  - If one repo fails, the rest still switch, and the failure says which repo, with
    "Activate anyway".
  - The header plug is lit when every repo holds the task; clicking it again turns
    them all off.
- **Space name** replaces the sidebar title ("Workspaces" / "Projects") whenever a
  space is active.
- **Project name** shows small and muted under each workspace card's title whenever
  the sidebar is not grouped by Project. It also covers Task mode, where every row in
  a task shares the same name.

## Tasks

- [ ] **1. Composer project picker filtered by the active space** (coder 1)
  - Check: unit tests for the filter and the picker sections.
- [ ] **2. Multi-repo worktree creation with `--add-dir`** (coder 1, after task 1)
  - Create the companions first and await their real paths. Then create the primary
    with the agent and `--add-dir=<path>` args, placed before the prompt; check the
    variadic risk.
  - Per-repo base branch, setup and hooks-trust decisions.
  - Check: unit tests for the orchestration and the args.
- [ ] **3. Group by Task + Group by remembered per space** (coder 2)
  - Check: grouping unit tests, persistence, and the menu option.
- [ ] **4. Spotlight the whole task from its header** (after task 3)
  - Check: unit tests for the batch activate and deactivate, and partial failure.
- [x] **5. Active space name as the sidebar title** (coder 3)
  - Check: component test.
  - Done: `SidebarHeader.tsx`, 22 tests. The title shows the space name under any
    grouping, with the full name in `title`. With no spaces it keeps the old label.
    The Agents view label is unchanged.
- [ ] **6. Muted project name on cards outside Project grouping** (coder 4)
  - Check: component test.

- [x] **7. Spotlight testing on by default for new projects** (main session, Juan asked
  mid-run)
  - `new-project-defaults.ts`, hooked into both add paths (`addRepoPath` and the
    dialog upsert). It runs after the space filing, sequentially, because both writes
    return the whole repo row.
  - Only local git repos get it: main drops the flag for folder and SSH repos.
  - Two upstream add-race expectations now include `spotlightTestingEnabled: true`.
  - Check: 12 files / 76 tests and oxlint.

## Verification rule

Coders run only their own test files and `oxlint` on their own files. No `pnpm tc`,
no full suite, no gate: Juan's CPU. The main session runs `pnpm tc` once at the end,
then commits each task.
