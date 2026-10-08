# Spotlight servers: field fixes (Orca Pro Max)

First real use (2026-10-08): whole-task Spotlight on AX-3447 in Local started no server.
Diagnosis, all read-only:
- **admin-action.** Yesterday Orca typed `pnpm install --frozen-lockfile && pnpm local`
  into its Spotlight terminal, and that server is still running on :3000.
  - Yesterday's turn-off sent no Ctrl-C, and today Orca typed the line again into the
    running server.
  - Cause: Juan's `pnpm` is a `/bin/sh` shim, so the terminal's foreground process is `sh`,
    and `isShellProcess` counts it as an idle shell. Bash scripts like `ax-dev-back` hit the
    same trap.
  - The flashlight shows "stopped" for the same reason.
- **reset, action-sport-club and checkout.** Their Spotlight tabs keep a persisted `ptyId`
  for a terminal that no longer exists: no shell has its cwd there, and the daemon doesn't
  know the session. Autostart treats it as live, nothing is typed, and the tab never
  respawns.
- **`.orca/spotlight.log`** has captured only Orca's notes, no terminal output, since about
  Oct 6 evening, even while admin's Next server runs. Likely cause: the daemon's data
  doesn't reach main for a session no renderer pane is attached to.

## Decisions (Juan, 2026-10-08: "dale, haz las 3")

- **A.** A terminal is idle only when its foreground process group is the terminal's own
  shell (process groups, not names), so a `sh`/`bash` script running in it counts as busy.
  This drives start, the Ctrl-C at turn-off, and the flashlight status. The Windows rule
  stays as it is (`confirmShellForeground`).
- **B.** A Spotlight tab whose PTY no longer exists is respawned in the background with
  the command queued (the new-terminal path), instead of being written to.
- **C.** The Spotlight terminal's output reaches `.orca/spotlight.log` whether or not its
  pane is on screen.

## Tasks

- [x] **1. A + B: real idle detection and dead-terminal respawn** (coder opus; idle = foreground group is the shell's own group via process table, `foregroundGroup` on the inspect response; dead PTY → `terminal-gone` → `clearTabPtyId` → queued respawn; flashlight via gated `spotlight:serverState`)
  - Check: unit tests for a `sh`/`bash` child in the foreground → busy, prompt → idle,
    turn-off Ctrl-C, flashlight status; dead PTY → no-terminal → stale `ptyId` cleared →
    prepare/queue/background mount.
- [x] **2. C: log mirror receives output from unattached terminals** (coder opus, `681d13cf0e`; daemon streams only to attached clients and nothing re-attached background Spotlight sessions after a restart → mirror reads the runtime data feed via a non-view output observer that triggers the existing subscriber-driven attach)
  - Check: a test proving data from a background (unattached) daemon session reaches the
    mirror; the existing log-mirror tests stay green.

## Verification rule

Coders run only their own test files and `oxlint` on their own files. The main session
runs `pnpm tc` once at the end and commits each task. No rebuild without asking Juan.
