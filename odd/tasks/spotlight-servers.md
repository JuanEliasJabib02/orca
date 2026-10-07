# Spotlight starts the dev servers (Orca Pro Max)

Today, turning on a Spotlight opens a "Spotlight" terminal at the repo root and nothing
else. Juan then visits each project root and types the server command by hand: four
times for a task like AX-3447 (backend-action, action-sport-club, reset, admin-action).
Goal: turning on a Spotlight (one repo or a whole task) starts each repo's server in
its Spotlight terminal, in the background, on a fixed port, against the backend Juan
picks. Builds on `odd/tasks/task-workflow.md`, on the same branch.

## Decisions (Juan, 2026-10-06)

- **A server command per repo and environment, stored in Orca** (never committed to
  the repo): Local, Dev and Prod commands, plus a port.
  - Orca prefills them from the root `package.json` scripts named `local` / `dev` /
    `prod` (`pnpm local`, …). Juan only corrects what doesn't fit: `ax-dev-back` for
    the backend, `pnpm dev:do` / `pnpm prod:do` for landing.
  - A repo with no Local command uses its Dev one in Local (landing has no `local`).
  - A repo with no command for an environment isn't started in it (the backend in
    Dev/Prod; the fronts then hit the remote backend).
- **Fixed ports**: admin-action 3000, landing_action_experience 3001 (any country),
  reset 3002, action-sport-club 3004; backend 8080 (set by `ax-dev-back`).
  checkout-action-experience: 3003 unless Juan says otherwise.
  - Orca appends `--port N` to the command. Verified in Next 15.5 / 16.2: the last
    `--port` wins (it overrides landing's per-country `--port`), and an explicit port
    turns off Next's move-to-the-next-free-port, so a busy port fails loudly.
  - Landing on one port ⇒ one country at a time.
- **Environment per task, Local by default.** Juan almost always codes against his
  local backend; Dev is for transactions. Orca remembers the last environment of each
  task (keyed by the task key, so a lone workspace has one too).
- **Quick switch**: an environment pill next to the task's flashlight
  (`Local ▾` → Local / Dev / Prod). Switching restarts only the repos whose command
  changes; the backend keeps running when going to Dev, so going back is instant.
- **Start only an idle terminal**: if the Spotlight terminal already runs something
  (Juan started it by hand), Orca leaves it alone.
- **Restart** re-runs the configured command instead of the shell's last command.
- **Spotlight off stops its servers** (Ctrl-C in the Spotlight terminal; the tab and
  its log stay). The root goes back to its own branch, so a running server would
  silently serve other code. Deleting the holder workspace already turns Spotlight off
  first, so it stops the server too.
- **Dependencies**: when `pnpm-lock.yaml` differs between what the root had and what
  the Spotlight puts there, the next start/restart runs
  `pnpm install --frozen-lockfile && <command>` in the Spotlight terminal. If the
  server is running when a workspace switch changes the lockfile, Orca restarts it
  that way. The backend (`uv run`) syncs its own deps.
- **Status at a glance**: each row's flashlight shows whether its server is running,
  with the port in the tooltip.

## Tasks

- [ ] **1. Per-repo server config: model, persistence, resolver**
  - `Repo.spotlightServer?: { local?: string; dev?: string; prod?: string; port?: number }`
    through every `updateRepo` layer (renderer action + sanitizer, preload, main IPC
    Pick + guard, tracking-repos write, loading store, runtime settings controller,
    RPC zod). Local git repos only, like `spotlightTestingEnabled`.
  - Pure resolver `resolveSpotlightServerCommand(config, detected, env)`: saved value,
    else detected, Local → Dev fallback, `--port N` appended; `null` when there's
    nothing to run.
  - Check: unit tests for the resolver and the sanitizer (trim, port 1-65535).
- [ ] **2. Detect scripts + settings UI**
  - Main reads the root `package.json` `scripts` (size cap like
    `repo-icon-autodetect.ts`) and the package manager (reuse
    `setup-script-package-manager-suggestion.ts`) → `{ local?, dev?, prod? }`.
  - `RepositorySpotlightSection`: Local / Dev / Prod command inputs (detected values as
    placeholders) and a Port input, under the Spotlight toggle. Searchable.
  - Check: detection unit tests (pnpm/npm/yarn, missing scripts, no package.json);
    component test for the section.
- [ ] **3. Environment per task (ui.json)**
  - `spotlightEnvByTaskKey: Record<string, 'local' | 'dev' | 'prod'>`, same shape as
    `composerCompanionRepoIdsByRepoId` (type, zod, hydration sanitizer, setter).
    Default `local`.
  - Check: persistence + sanitizer tests.
- [ ] **4. Main: start / restart / stop the Spotlight server**
  - The log capture keeps the server command. New IPC to start (writes the command
    only when the terminal is idle, via the PTY provider's foreground inspection) and
    restart (Ctrl-C, then the command; falls back to today's history recall when no
    command is known).
  - `deactivate` sends Ctrl-C to a busy Spotlight terminal before tearing the capture
    down. The `.orca/spotlight-restart` trigger uses the stored command.
  - Check: unit tests with a fake PTY provider (idle vs busy, restart, stop on
    deactivate, no command).
- [ ] **5. Lockfile check → install before start**
  - In `spotlight-service.ts`, after activate / takeover / non-skipped sync, compare
    `pnpm-lock.yaml` between the before and after commits
    (`git diff --quiet A B -- pnpm-lock.yaml`), outside the repo lock. Mark the repo
    "install pending"; the next start/restart prefixes
    `pnpm install --frozen-lockfile && `. A sync that changes it while the server runs
    triggers that restart. Only when the root has `pnpm-lock.yaml`.
  - Check: unit tests for the comparison per operation and the prefix.
- [ ] **6. Autostart on activation (one repo or the whole task)**
  - In `activateSpotlight`, after `openSpotlightTerminalTab`: resolve the command
    (task 1 + the worktree's task environment from task 3).
    - New tab, or a tab whose PTY died: `queueTabStartupCommand` before the pane
      mounts, plus `requestBackgroundTerminalWorktreeMount` so it spawns without
      revealing anything (today a `reveal:false` tab never spawns until Juan opens the
      main workspace).
    - Live tab: the start IPC from task 4 (idle only).
  - The whole-task button goes through `activateSpotlight`, so it starts every repo.
  - Check: unit tests for the three tab paths and "no command → nothing".
- [ ] **7. Environment pill on the task header**
  - `Local ▾` next to `TaskSpotlightButton`. On change: save it, then restart the held
    repos whose resolved command changes and exists in the new environment.
  - Same choice in a workspace row's context menu, for workspaces outside Group by
    Task.
  - Check: unit tests for which repos restart (backend kept in Dev, fronts switched);
    component test for the pill.
- [ ] **8. Server status on the flashlight**
  - While a Spotlight is active, main checks the terminal's foreground process
    periodically and emits an optional `server: { running, port? }` in
    `SpotlightRepoState` only when it changes.
  - Row flashlight: running vs stopped, port in the tooltip.
  - Check: unit tests for the poll/emit (no emit without a change, stops on
    deactivate); component test for the indicator.

## Verification rule

Coders run only their own test files and `oxlint` on their own files. No `pnpm tc`, no
full suite, no Electron runs. The main session runs `pnpm tc` once at the end, then
commits each task. Never rebuild or replace the live app without asking Juan.
