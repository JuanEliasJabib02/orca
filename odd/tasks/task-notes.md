# Personal notes on tasks (Orca Pro Max)

Action tickets show up in the sidebar only as their key (AX-3423), which says nothing
about what the task is. The key has to stay (that's how Action works), so Juan wants an
optional private note per task, e.g. "POS Action Wear", that he sees by hovering the
task header. Builds on `odd/tasks/task-workflow.md` and `odd/tasks/task-delete.md`, on
the same branch.

## Decisions (Juan, 2026-10-06)

- **The header doesn't change.** It keeps showing only the key; the note appears in a
  tooltip when hovering the task header. The tooltip shows only the note (no Jira
  title); no note, no tooltip.
- **Add / edit / remove** from the task header: right-click on it, and the same item in
  its `⋯` menu ("Add note…" or "Edit note…"). A small dialog with a text field; saving
  an empty note removes it.
- **Stored by task key in Orca's UI state** (ui.json), so it covers every repo of the
  task and survives restarts. Never written to Jira or the repos.
- **Deleting the task removes its note** once the delete actually happened.
- Only real tasks; the "No task" section has no note.

## Tasks

- [x] **1. Task notes: state, header tooltip, edit dialog, cleanup on delete** (coder, `0ae15d8674`; SectionHeader.tsx now at exactly 400 lines)
  - `taskNoteByTaskKey: Record<string, string>` in ui.json, same pattern as
    `spotlightEnvByTaskKey` (`ui-slice-spotlight-env-actions.ts`): type, zod,
    hydration sanitizer (trim, max 500 chars per note, max 500 entries, unsafe keys
    out), setter (empty removes).
  - Tooltip on the task header showing only the note.
  - "Add note…" / "Edit note…" in `TaskHeaderMenu` and on right-click of the task
    header, opening a small dialog.
  - `TaskHeaderMenu`'s delete passes `onDeleted` and removes the note when every task
    worktree was deleted.
  - Check: unit tests for the setter/sanitizer, the tooltip content, the menu items,
    and the cleanup on delete.

## Verification rule

The coder runs only its own test files and `oxlint` on its own files. No `pnpm tc`, no
full suite, no Electron runs. The main session runs `pnpm tc` once at the end, then
commits. Never rebuild or replace the live app without asking Juan.
