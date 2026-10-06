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

- [x] **1. Composer project picker filtered by the active space** (coder 1, `7bf8ecc7d0`)
  - Check: unit tests for the filter and the picker sections.
- [x] **2. Multi-repo worktree creation with `--add-dir`** (coder 1, `7bf8ecc7d0`; state `9de9c79ce5`)
  - Create the companions first and await their real paths. Then create the primary
    with the agent and `--add-dir=<path>` args, placed before the prompt; check the
    variadic risk.
  - Per-repo base branch, setup and hooks-trust decisions.
  - Check: unit tests for the orchestration and the args.
- [x] **3. Group by Task + Group by remembered per space** (coder 2, `80d6f7e5c7`; state `9de9c79ce5`; regex tightened: no-separator keys need 2+ digits)
  - Check: grouping unit tests, persistence, and the menu option.
- [x] **4. Spotlight the whole task from its header** (coder 5, `47a59bcf05`)
  - Check: unit tests for the batch activate and deactivate, and partial failure.
- [x] **5. Active space name as the sidebar title** (coder 3)
  - Check: component test.
  - Done: `SidebarHeader.tsx`, 22 tests. The title shows the space name under any
    grouping, with the full name in `title`. With no spaces it keeps the old label.
    The Agents view label is unchanged.
- [x] **6. Muted project name on cards outside Project grouping** (coder 4, `c704ac87ee`; own line under the title, `opacity-70`)
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

## Verification (2026-10-06)

- Full `pnpm tc` is clean with everything combined.
- One run over the touched areas passes: 99 test files / 894 tests (changed tests
  plus the sidebar `worktree-list`, `new-workspace`, `composer-state`, switcher,
  header and order tests).
- `check:code-quality:changed`: back to the 60 earlier fork findings. The one new
  finding, the existing `as UISlice` cast now inside a changed block, got a SAFETY
  disable.

Open, left for Juan:
- `--add-dir` doesn't reach chat-view sessions, which ignore launch args.
- Companions don't copy linked work items.
- No per-repo progress text while companions are being created.

## Strict review (2026-10-06, Opus + Sonnet)

Verdict: APPROVED ✅, after one fix round.
- Confirmed by both judges, then fixed:
  - J-001: once a companion exists, a late dismissal completes the set; if the
    primary then fails, a toast names the companions.
  - J-002: on the chat-view route the access checkbox is hidden and no `--add-dir` is
    built.
- Fixed at Juan's request:
  - J-003: batch Spotlight failure toasts name the project.
  - J-004: companions on a suffixed branch are listed.
  - J-007: a space switch keeps collapsed sections.
  - J-008: re-check cancellation after the first setup read.
- Left as info:
  - J-005: separator keys still match words like `node-20`.
  - J-006: no glue test for `--add-dir` in `buildQuickComposerStartup`.
  - The primary's own branch suffix isn't checked.
