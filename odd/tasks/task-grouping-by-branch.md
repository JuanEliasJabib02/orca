# Group by Task without a ticket key (Orca Pro Max)

Group by → Task only understands Jira-style keys (`AX-3447`). Outside Action, Juan
names work freely: "merchant-doc-cost-review" created in merchant-doc-agent and
ai-bulk-hours landed in "No task" instead of one task. Builds on
`odd/tasks/task-workflow.md`, on the same branch.

## Decisions (Juan, 2026-10-06)

- **No ticket key → the branch name is the task.** Worktrees without a key whose branch
  (last `/` segment, case-insensitive) is the same in **2 or more repos** form one task
  named after that branch, e.g. "merchant-doc-cost-review".
- A key-less branch that exists in only one repo stays in "No task", so single
  workspaces don't each get a header.
- Ticket keys keep priority: a worktree with a key is grouped by its key, as today.
- Never grouped by name: main worktrees, detached HEADs, folder workspaces.
- The task is a normal task: header, note, Delete task, whole-task Spotlight, and (later)
  its Spotlight environment all use that name as the task key.

## Tasks

- [x] **1. Branch-name tasks in the grouping** (coder, `6dcbf0f63b`; index over every non-archived worktree so filters never split a task; smallest casing wins)
  - One resolver that, given every visible worktree, returns each worktree's task key
    (ticket key, else a shared branch name, else null). Every consumer of
    `getWorktreeTaskLaneKey` (`worktree-grouping.ts`, `worktree-group-keys.ts`,
    `task-sections.ts`) uses it, so a worktree never lands in different sections
    depending on who asks.
  - Exported so the Spotlight-server work can ask for one worktree's task key.
  - Check: unit tests for shared names across repos, single-repo names, key priority,
    case/prefix tolerance (`juan/foo` vs `foo`), main/detached/folder exclusion, and the
    existing Task grouping tests still passing.

## Verification rule

The coder runs only its own test files and `oxlint` on its own files. No `pnpm tc`, no
full suite, no Electron runs. The main session commits.
