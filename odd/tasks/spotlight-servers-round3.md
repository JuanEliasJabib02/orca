# Spotlight servers, round 3: Python deps, silent skips (Orca Pro Max)

Third real run on AX-3447 (2026-10-09 ~02:18Z), seven repos, all with server commands saved:
- **backend-action-experience:** `ax-dev-back` was already running from the previous task. On the
  code switch, uvicorn's `--reload` reloaded into AX-3447, which adds `pypdf` to
  `pyproject.toml`/`uv.lock`. A reload never installs, so it crashed with
  `ModuleNotFoundError: No module named 'pypdf'`. `uv run` only syncs when the command starts.
- **reset, action-sport-club:** Orca typed nothing. Their logs show the mirror line, a fresh
  capture and a prompt, but no "Server started by Orca" line. landing and action-experience in the
  same activation got one. Both have a `local` script, a pnpm lockfile, `node_modules`, and a saved
  port (3002 / 3004), so the command was resolvable.
- **landing:** started, but `EADDRINUSE :3001`: an old checkout `next-server` from Oct 8 held it.
  That was operational: checkout was restarted on 3003.

## Decisions (Juan, 2026-10-09: "sí dale, porque en servidores de Python eso se usa así, arregla todo")

- **`uv.lock` gets the same treatment as `pnpm-lock.yaml`.** When it differs between what the root
  had and what the Spotlight puts there, or the root has `uv.lock` but no `.venv`:
  - the next start or restart runs `uv sync --frozen && <command>` (PowerShell 5.1:
    `uv sync --frozen; if ($?) { <command> }`);
  - a running server Orca launched is restarted that way.
  - Python dev servers reload on code changes but never install, so a switch that adds a
    dependency must restart.
- **No more silent skips.** Every autostart decision writes one line to the repo's
  `.orca/spotlight.log`: started, left alone because the terminal is busy, no command for `<env>`,
  queued for a new terminal, or failed with a reason. A skip like reset's is then readable instead
  of inferred.
- **Find and fix why reset and sport-club were skipped**, with a regression test.
- **Generated files don't block turn-off** (Juan: "arregla esto también"). Turning off the
  Spotlight in reset and sport-club failed with "root has changes made outside the Spotlight
  workspace". The only change was `next-env.d.ts`, which `next dev` (Next 16) rewrites on start,
  and it's tracked there. Changes limited to known framework-generated files (`next-env.d.ts`, at
  any depth) no longer count as root divergence. The existing reset restores them.

## Tasks

- [x] **1. Autostart decision notes + the reset/sport-club skip** (coder opus, `a06ffc131e`; cause: after an app restart the start read the terminal before main's attach finished → unknown → busy; now waits ≤3s for the attach)
  - Check: tests for each note, and a regression test reproducing the skipped repos in a
    whole-task activation.
- [x] **2. `uv.lock` change or missing `.venv` → `uv sync --frozen` before start/restart** (`ad8dedec0d`)
  - Check: unit tests mirroring the pnpm lockfile tests (activate, takeover, sync, PowerShell
    variant, no `uv.lock` → nothing).

- [x] **3. Framework-generated files (`next-env.d.ts`) don't count as root divergence** (also fixed the git helper trimming the first porcelain line)
  - Check: guard tests for deactivate, sync and takeover with only `next-env.d.ts` changed (root
    and nested) versus mixed with a real change.

## Open

- After an app restart, turning a Spotlight off can't stop a server Orca started before the
  restart: main no longer knows that terminal. That's how checkout's Oct 9 server held 3001.
  Follow-up: re-register the terminals of active Spotlights at startup.

## Verification rule

Coder runs only its own test files (`--maxWorkers=2`) and `oxlint` on its files. The main session
runs `pnpm tc` once and commits each task. Rebuild only when Juan asks.
