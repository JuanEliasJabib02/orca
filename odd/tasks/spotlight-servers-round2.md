# Spotlight servers, round 2: task switch, countries, and the gaps the field found (Orca Pro Max)

After the field fixes (`odd/tasks/spotlight-servers-field-fixes.md`), the second real try
on AX-3447 showed:
- checkout started.
- reset and sport-club failed with `next: command not found`: their roots never had
  `pnpm install`.
- admin's existing terminal is never typed into: the running terminal daemon is from
  Oct 1 and doesn't send the new `foregroundGroup`.
- backend and landing have no detectable command.

Juan also asked for:
- landing's country chosen without editing settings;
- switching the Spotlight to another task turning the previous one off;
- the Workspace board not listing every repo's `main` workspace.

## Decisions (Juan, 2026-10-08/09: "sí, dale, implementa todos los cambios")

- **Install when dependencies are missing.** A pnpm repo whose root has no
  `node_modules` gets the same `pnpm install --frozen-lockfile` chain as a lockfile
  change, on the next line Orca types or queues.
- **Busy detection without the new daemon.** When the daemon doesn't send
  `foregroundGroup`, main works it out itself from the process table: the PTY's root
  pid, then the shell's pgid, then the tty's foreground pgid. The rule is the same as
  the daemon's, so admin and the flashlight dots work without restarting the daemon.
- **Countries (variants), landing only in practice.**
  - Orca detects variants from scripts like `dev:<v>` / `prod:<v>` (do, gb, pt, es, ec,
    br).
  - Commands may hold `{variant}` (shown as `{país}`-like in settings help).
  - Orca infers the variant from what the task's branch changed (`apps/DO/**` → `do`).
    If that's ambiguous or missing, it uses the task's last choice; if there's none
    either, a small prompt on activation lists the countries, and one click remembers
    it for that task.
  - A small `DO` tag next to the repo's flashlight shows while its Spotlight is on.
    Clicking it changes the country, which restarts only that repo's server.
  - Repos without variants show nothing new.
- **Task switch, same space only.** Turning on a task's flashlight turns off every
  other Spotlight in the same space whose repo isn't in the new task: its server
  stops and the root goes back to its branch. Repos in both tasks switch code (restart
  only if the command changes); new repos start. Other spaces are untouched. A row's
  flashlight keeps today's per-repo behaviour.
- **Workspace board without primaries.** The board never lists a repo's main (primary)
  worktree. The sidebar is unchanged.
- **One-time.** `pnpm install` in the reset and sport-club roots (done by main).

## Tasks

- [ ] **1. Install when `node_modules` is missing + main-side busy fallback** (main
  Spotlight server code)
- [ ] **2. Variants (countries): detection, `{variant}`, inference, per-task memory,
  prompt, tag + menu**
- [ ] **3. Task switch turns off the previous task in the same space**
- [ ] **4. Workspace board hides primary worktrees**

## Verification rule

Coders run only their own test files and `oxlint` on their own files. The main session
runs `pnpm tc` once at the end and commits each task. Rebuild only when Juan asks.
