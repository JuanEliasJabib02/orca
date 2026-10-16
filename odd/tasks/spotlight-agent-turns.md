# Spotlight turns for agents (Orca Pro Max)

Agents test their own task: `orca spotlight on` lights the Spotlight of the caller's task (every
eligible project, like the task-header button), starts the servers and waits until they listen.
When two tasks want the same project, they wait in line.

## Decisions (Juan, 2026-10-14)

- "Casi nunca soy yo trabajando, siempre son agentes": no permission prompt for Juan. Agents
  queue among themselves. Juan reviews by hand when no agent is testing; his clicks always win.
- **Per project, all or nothing.** A task asks for all its projects at once. Tasks with no project
  in common test at the same time. A task never holds half of what it needs (no deadlock).
- **First come, first served.** A later request never jumps an earlier one that wants the same
  project. Requests with no overlap don't wait for each other. Confirmed by Juan (2026-10-15, "eso
  así me gusta"): a task whose project is free still waits behind an earlier request for it, so a
  big task never starves behind a stream of small ones.
- **Same task shares the turn.** A second agent of a task that already holds its turn joins it.
- **`orca spotlight off` gives the turn back; it doesn't turn anything off.** Nobody waiting → the
  last tested task stays lit for Juan to look at. Someone waiting → the next task takes it over.
- **Turns are released by themselves** when the holder's terminal closes or its agent finishes
  its turn (hook status `done` newer than the request), so a forgotten turn never blocks the line.
- **A place in line belongs to the agent's pane** (`ORCA_PANE_KEY`), not to the CLI call. `on`
  waits up to `--timeout-ms` (default 100 s, under an agent shell's 2 min cap) and can be rerun
  to keep waiting; a killed call never loses its place.
- **In memory.** An app restart empties turns and line; agents ask again.
- **Local only.** SSH projects can't hold a Spotlight today; `on` says so.

## Shape

- Main owns the line (`SpotlightTurnQueue`, pure) and the turns service (activation, readiness,
  auto-release). The renderer owns everything the button already does: resolving the task's
  projects and lighting them (`runTaskSpotlightBatch`, server autostart, env, variant). Main asks
  it over a request/reply IPC channel, the `terminal:requestTabCreate` pattern.
- Readiness: main polls `scanWorkspacePorts(repoId)` for a port owned by the repo root (the
  configured port when the repo has one). Not listening by the deadline → `on` still answers with
  the server state and the log path.
- RPC `spotlight.on` / `spotlight.off` / `spotlight.status` (permission `workspace`), CLI
  `orca spotlight on|off|status`.

## Tasks

- [x] **1. Main: the turn queue** — `2d25f39996`
  - `src/main/spotlight/spotlight-agent-turn-queue.ts`: `request`, `release`, `snapshot`,
    `findPane`; grants in FIFO order per project, all or nothing, same-task join.
  - Check: `spotlight-agent-turn-queue.test.ts` (no overlap → both granted; overlap → waits and is
    granted on release; no overtaking; same-task join; release of a waiter; position/blockers).
- [x] **2. Renderer: resolve and light a task for main** — `3d31e4844a`
  - Shared types `src/shared/spotlight-agent-turn.ts`.
  - Preload `spotlight.onAgentTaskRequest` / `replyAgentTaskRequest` (+ web stub); registered by
    `SpotlightAgentTaskGate` in `AppBackgroundServices`.
  - `src/renderer/src/lib/spotlight-agent-task-requests.ts`: `resolve` (task key + eligible
    members, caller's worktree wins in its repo) and `light` (`runTaskSpotlightBatch` with no
    switch-away, only when not already lit; per-project results; one toast).
  - Main requester `src/main/spotlight/spotlight-agent-task-request.ts` (requestId, timeout).
  - Check: tests for member resolution.
- [x] **3. Main: turns service + RPC** — `f66025d90c`
  - `src/main/spotlight/spotlight-agent-turns.ts`: `on` (resolve → queue → light on grant →
    readiness), `off`, `status`; grants light right away even when no call is waiting;
    auto-release on `done` and pane teardown. Configured from `registerSpotlightHandlers`.
  - `src/shared/rpc-contract/spotlight-params.ts`, `src/main/runtime/rpc/methods/spotlight.ts`,
    registered in `methods/index.ts`; regenerate the params catalog.
  - Check: service tests with fakes (grant on release lights the next task, done/teardown release,
    readiness by configured port and by root-owned port).
- [x] **4. CLI `orca spotlight on|off|status`** — `470aa8c471`
  - Spec, handler, manifest, root help, formatter; `on` exits 1 while still waiting.
  - Check: handler tests (params from env, client timeout, exit code, text output).
- [x] **5. Tell agents** — `5ed7cfa7d4` (the CLAUDE.md part still waits for the rebuild)
  - `SPOTLIGHT_AGENT_GUIDANCE` mentions the commands (it also drops the pointer to
    `.orca/spotlight-state.json`, which goes stale, for `orca spotlight status`).
  - Dropped: a section in the bundled orca-cli skill (it's a generated bundle shared with upstream;
    the guidance already reaches Claude in every Spotlight project).
  - After the rebuild, with Juan's OK: `~/.claude/CLAUDE.md` Spotlight/Playwright rules point at
    `orca spotlight on` instead of "ask Juan".

## Status

Verified 2026-10-15: RPC params catalog regenerated; oxfmt + oxlint clean on changed files; 8 test
files / 122 tests pass (the 4 new ones + ipc/spotlight, handler manifest, CLI index, caller scope);
full typecheck passes. Tools run directly in the worktree (pnpm 12 refuses `pnpm run` here):
`node config/scripts/run-typecheck-projects-in-parallel.mjs`, vitest via
`node node_modules/vitest/vitest.mjs run --config config/vitest.config.ts`.

Next (Juan's call): merge into `orca-pro-max`, rebuild, try it with two agents, then update the
`~/.claude/CLAUDE.md` Spotlight/Playwright rules. Nothing pushed.

## Follow-ups (not in v1)

- `--variant` for repos whose variant can't be inferred (today the existing toast asks Juan).
- Show in the sidebar which task's agent holds a project.

## Verification rule

No tests, typecheck or lint while building (Juan's CPU). At the end, with Juan's OK: the new test
files only, `pnpm tc`, `oxlint` on changed files, catalog check. Rebuild only when Juan asks.
