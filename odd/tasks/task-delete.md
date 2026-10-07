# Delete a whole task (Orca Pro Max)

With Group by → Task, a finished task (AX-3450) leaves one worktree per repo behind.
Today Juan has to Shift-click every row, right-click and Delete. Goal: delete the task
from its header in one step. Status management stays in Jira, so there's no
"Move task to Done": when a task is finished, Juan deletes it. Builds on
`odd/tasks/task-workflow.md`, on the same branch.

## Decisions (Juan, 2026-10-06)

- **"Delete task…"** in a `⋯` menu on the task header, like the project group header
  menu. Only on real tasks; the "No task" section has none.
- It opens the existing multi-workspace delete dialog with every worktree of the task
  across repos. Nothing new about confirmation: that dialog always confirms and warns
  about uncommitted changes.
- Main worktrees are never included. Folder workspaces in the section are left out.
- A worktree holding a Spotlight already turns it off before deletion, which will also
  stop its server once `odd/tasks/spotlight-servers.md` lands.

## Tasks

- [ ] **1. `⋯` menu with "Delete task…" on the task header**
  - New `TaskHeaderMenu` in the header actions (reuse `ProjectGroupHeaderMenu`'s
    dropdown pattern), rendered when `row.task?.taskKey`.
  - Map `task.worktrees` to delete identities from the store (id, instanceId, hostId),
    drop main worktrees, and call `runWorktreeBatchDelete`.
  - Check: unit test for the target list (main worktrees out, every repo in);
    component test that the menu shows only on keyed tasks.

## Verification rule

The coder runs only its own test files and `oxlint` on its own files. No `pnpm tc`, no
full suite, no Electron runs. The main session runs `pnpm tc` once at the end, then
commits. Never rebuild or replace the live app without asking Juan.
