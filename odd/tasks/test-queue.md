# Test queue: one test turn for the whole Mac (Orca Pro Max)

Today `orca spotlight on` queues per shared project: tasks of the same repo wait for each other,
tasks of different repos test at the same time, and nothing caps Playwright or Maestro globally.
Several `tester` agents at once freeze the 16 GB MacBook Air and burn the Claude limit. This
feature turns the turn into a global one: at most N tasks (default 1) test at a time, whatever
their repos; `status` and the sidebar show who tests and who waits; the harness takes the turn
before testing and a hook keeps any agent from skipping the line.

Brief: Engram `odd/test-queue/brief` (#2704). Previous feature: `odd/tasks/spotlight-agent-turns.md`.

## Decisions (Juan, 2026-11-03; design 2026-11-03)

- **The turn is the cap.** `orca spotlight on` grants a turn only while fewer than N distinct tasks
  hold one (N = global setting `spotlightMaxConcurrentTests`, default 1). Project overlap keeps
  working as before on top of that. Lowering N never evicts a holder; it only stops new grants.
- **FIFO without overtaking stays.** When the cap is reached, every waiter whose task holds no
  turn waits in arrival order; a pane of a task that already holds a turn still joins it (same
  task shares the turn). Later waiters never pass an earlier one blocked by the cap.
- **Maestro and simulator tests go through the same line.** A task with no Spotlight-eligible
  project (mobile, or Spotlight off in the repo's settings) no longer gets an error from `on`:
  it takes a turn with no project to light, so the cap covers it, and `on` says why nothing was lit.
  Rejected: a second, separate line for mobile (two lines, two places to jam).
- **The cap lives in Orca Settings, not in a config file.** Field in `GlobalSettings`, read by
  main with `store.getSettings()` through an injected getter, edited in the Settings UI.
  Rejected: an env var or a file in `~/.orca` (invisible, and main would need a watcher).
- **The monitor is `status` plus the sidebar.** Main pushes the queue snapshot to the window on
  every change (`spotlight:turnsChanged`); the task header shows `Testing` / `Waiting #n`.
  Rejected: polling `status` from the renderer.
- **The hook asks Orca, never a file.** `orca spotlight status --json` gains `mine` (the caller's
  pane: holding / waiting / none, computed from `ORCA_PANE_KEY`), and the PreToolUse hook blocks
  Playwright, `maestro test`, `simctl … recordVideo` and `adb … screenrecord` unless `mine.kind`
  is `holding`. Outside an Orca terminal (no `ORCA_PANE_KEY`) or against an Orca that does not
  send `mine` yet (before the rebuild) the hook allows and says so on stderr.
  Rejected: a lock file in my-mac-scripts (a dead session leaves it stuck; two lines).
- **The harness releases between rounds.** `tester` runs `orca spotlight off` at the end of every
  round, before reporting, so the next task tests while the `coder` fixes; the next round takes
  the turn again. Playwright scripts are named `*.playwright.mjs` / `*.playwright.py` so the hook
  recognises them (`node flow.mjs` would slip past otherwise).
- **Existing auto-release stays** (agent `done` newer than the request, pane closed): it is what
  keeps a dead session from jamming the single line. Still in memory, still local only.
- **Wire compatibility:** `mine` and `cap` are new optional fields of `spotlight.status`; the
  status params object is new but optional, so an old CLI against a new host and a new CLI
  against an old host both keep working.
- **Verification rule (Juan's CPU):** no tests, typecheck or lint while building. At the end,
  with Juan's OK: the touched test files only, run directly (pnpm 12 refuses `pnpm run` in the
  worktree: `node node_modules/vitest/vitest.mjs run <files>`), `./node_modules/.bin/oxlint` and
  `oxfmt` on changed files, the RPC params catalog check, then the full typecheck once. Rebuild
  and reinstall (`/orca-update rebuild`) only when Juan asks, after the merge into orca-pro-max.
- **Harness commits:** `~/.claude` already has unrelated uncommitted edits (CLAUDE.md,
  settings.json, hooks/bash-hook-lib.sh, block-destructive.sh). Harness tasks stage only their own
  files (`git add <paths>`), never `git add -A`.
- **Risks:** (1) the queue test for "cap reached, same-task join" must not let a join create a
  new turn; (2) the Settings pane hosting the row has a 300-line cap on some test harnesses, so
  the row is its own component; (3) the hook runs on every Bash call: it must exit fast when the
  command has no test tool in it, and call `orca` only when it does.

## Shape

- Pure queue (`SpotlightTurnQueue`) learns the cap through a getter; `pump` counts distinct
  holding tasks before granting a waiter whose task holds nothing. `positionOf` reports cap
  blockers as `{ taskKey, repoIds: [], holding: true }`.
- `SpotlightAgentTurns` stops rejecting zero-member tasks, reports `mine` and `cap` in `status`,
  and calls a `notify` dep after every queue change. Wiring sends `spotlight:turnsChanged`.
- Renderer: slice field `spotlightTurns`, bridge subscription, hydrate on mount, badge in
  `TaskSectionHeader` (shared by the list and the kanban card).
- CLI: `status` sends `paneKey` when the env has it; formatter prints the limit and the caller's
  place; `on` explains a turn with nothing to light.
- Harness: hook `block-test-without-turn.sh` + settings.json entry; `verify` skill, `tester`
  agent, `spotlight` skill and CLAUDE.md say to take the turn, release between rounds, name the
  scripts.

## Tasks

- [ ] **1. Queue: global cap and slot-only turns**
  - **What**: `SpotlightTurnQueue` grants a waiter whose task holds no turn only while the number
    of distinct holding tasks is below the cap; a request with `repoIds: []` is valid and takes a
    turn (a slot) like any other; same-task panes still join past the cap; FIFO is untouched.
    `positionOf` lists the cap blockers (every holding task not already listed, `repoIds: []`,
    `holding: true`) and counts earlier other-task waiters ahead when the cap applies.
  - **Where**: `src/main/spotlight/spotlight-agent-turn-queue.ts`,
    `src/main/spotlight/spotlight-agent-turn-queue.test.ts`.
  - **How**: constructor becomes `new SpotlightTurnQueue({ now?, cap?: () => number })` (default
    cap `() => 1`; keep the old `(now)` call sites compiling by accepting both or updating the two
    callers: `spotlight-agent-turns.ts` and the test). In `pump`, `let holding = this.turns.size`;
    for each waiter: `free` additionally requires `this.turns.has(waiter.taskKey) || holding <
    cap()`; on a grant of a new task `holding += 1`; a waiter blocked by the cap still marks its
    repos claimed (existing line). The `join` path never creates a turn, so it ignores the cap.
    Cap is read once per `pump` call. Lowering it never evicts.
  - **Verify**: `node node_modules/vitest/vitest.mjs run src/main/spotlight/spotlight-agent-turn-queue.test.ts`
  - **Done when**: the existing tests pass unchanged and new ones cover: cap 1 with two tasks on
    different repos → second waits with a cap blocker and position 2, granted on release; cap 2 →
    both granted; cap 1, second pane of the holding task → joins; `repoIds: []` request → holds a
    turn and blocks the next task under cap 1; cap raised between pumps → next `request`/`release`
    grants the waiter.

- [ ] **2. Setting: `spotlightMaxConcurrentTests` with a Settings row**
  - **What**: a global numeric setting "Tasks testing at once" (min 1, max 8, default 1) that
    main can read synchronously and Juan can change in Orca Settings.
  - **Where**: `src/shared/global-settings-types.ts` (field, with a one-line `Why:` comment),
    `src/shared/default-global-settings.ts` (default 1), new
    `src/renderer/src/components/settings/SpotlightTestingCapSetting.tsx` mounted at the end of
    `src/renderer/src/components/settings/TerminalInteractionSection.tsx` (it already receives
    `settings` and `updateSettings`), search entry in the section's search-entries file
    (`terminal-search.ts`), tests next to the existing settings tests
    (`src/main/persistence-settings-ui-defaults.test.ts` pattern) if a default-table test exists.
  - **How**: numeric control patterned on `TerminalFontSizeSetting.tsx` (same primitives from
    `components/ui/`, tokens from `main.css`, `translate('auto.components…', 'English')` for
    every string, wrapped in `SearchableSetting` + `matchesSettingsSearch`). Reads
    `settings.spotlightMaxConcurrentTests ?? 1`, writes
    `updateSettings({ spotlightMaxConcurrentTests: n })` clamped to 1..8. No new color or font
    size; `pnpm run check:code-quality:changed` must stay clean on the new file.
  - **Verify**: `./node_modules/.bin/oxlint src/renderer/src/components/settings/SpotlightTestingCapSetting.tsx src/renderer/src/components/settings/TerminalInteractionSection.tsx && node node_modules/vitest/vitest.mjs run src/main/persistence-settings-ui-defaults.test.ts`
  - **Done when**: lint clean, the defaults test passes (with the new default added where the
    test enumerates defaults), and `grep -n spotlightMaxConcurrentTests src/shared/default-global-settings.ts` shows `1`.

- [ ] **3. Turns service, RPC and CLI: cap, `mine`, slot-only `on`, change notifications**
  - **What**: `on` for a task with no Spotlight-eligible project takes a turn with nothing to
    light and answers `status: 'on'` with `servers: []`, `ready: true`, `skippedRepoNames` and a
    new optional `note` explaining it (the old error text). `status` takes an optional `paneKey`
    and returns `cap` and `mine: { kind: 'holding' | 'waiting' | 'none'; taskKey?; position? }`.
    Every queue change (request, release, grant, auto-release) calls a `notify(status)` dep. CLI
    `status` sends `ORCA_PANE_KEY` when present; text output prints `Limit: N task(s) at a time`
    and `You: holding the turn of X | #n in line for X | no turn`; `on` prints the note.
    `SPOTLIGHT_AGENT_GUIDANCE` says the turn is one for the whole machine (one sentence, same
    quoting rules as the existing string: no quotes, backslashes, `$`, backticks, parentheses).
  - **Where**: `src/main/spotlight/spotlight-agent-turns.ts`, `spotlight-agent-turns-wiring.ts`
    (deps: `getCap: () => args.store.getSettings().spotlightMaxConcurrentTests ?? 1`,
    `notify: (status) => args.getWindow()?.webContents.send('spotlight:turnsChanged', status)`),
    `src/shared/spotlight-agent-turn.ts` (types), `src/shared/rpc-contract/spotlight-params.ts`
    (`SpotlightStatusParams` with optional `paneKey`), `src/main/runtime/rpc/methods/spotlight.ts`
    (status takes params), the RPC params catalog (regenerate with the repo's script; find it
    with `rg -l "spotlight.on" config/ docs/ src/shared/rpc-contract`), `src/cli/handlers/spotlight.ts`,
    `src/cli/spotlight-format.ts`, `src/shared/spotlight-agent-guidance.ts`, tests
    `spotlight-agent-turns.test.ts`, `src/cli/handlers/spotlight.test.ts`.
  - **How**: the queue is built with `{ now, cap: deps.getCap }` (task 1). Zero members: skip the
    throw, queue with `repoIds: []`, skip `light` and `waitForServers`, return
    `{ status: 'on', taskKey, servers: [], skippedRepoNames, ready: true, note }`. `mine` from
    `queue.positionOf(paneKey)`; `cap` from `getCap()`. `notify` is called at the end of `on`
    (after `queue.request`), `off`, and inside `onGranted`; it must never throw out of `off`
    (wrap in try/catch, like the async `resolveTask` reasoning in the wiring). Wire compat: all
    new fields optional; the CLI tolerates a host that returns no `mine`/`cap` (prints nothing
    for them). `paneKey` on `status` is optional (`z.string().trim().min(1).optional()` or the
    repo's optional-string primitive in `rpc-param-primitives`).
  - **Verify**: `node node_modules/vitest/vitest.mjs run src/main/spotlight/spotlight-agent-turns.test.ts src/cli/handlers/spotlight.test.ts src/main/runtime/rpc/methods/spotlight-params-catalog.test.ts 2>&1 | tail -30` (replace the catalog test path by the real one found with `rg -l "params catalog" src --glob '*.test.ts'`).
  - **Done when**: tests pass and cover: zero-member task gets a turn and blocks another task
    under cap 1; `status` with the holder's pane → `mine.kind === 'holding'`, with a waiter's →
    `'waiting'` with position, unknown → `'none'`; `notify` fires on request, release and on
    auto-release by `done`; CLI `status` sends `paneKey` only when `ORCA_PANE_KEY` is set and the
    text shows the limit and the caller's place; the catalog test passes after regeneration.

- [ ] **4. Sidebar monitor: `Testing` / `Waiting #n` on the task header**
  - **What**: the task header (list and kanban) shows a badge `Testing` when an agent holds the
    task's turn and `Waiting #n` while it is in line; the badge updates live and on app start.
  - **Where**: `src/preload/api/spotlight-bridge.ts` + `spotlight-api.ts` (+ the web stub next to
    the other spotlight stubs: `rg -l onChanged src/renderer src/preload --glob '*stub*'`),
    `src/main/ipc/spotlight.ts` (handler `spotlight:getTurns` → `getSpotlightAgentTurns()?.status() ?? null`),
    `src/renderer/src/store/slices/spotlight.ts` (field `spotlightTurns: SpotlightAgentStatus | null`,
    `applySpotlightTurns`), `src/renderer/src/hooks/ipc-events/project-catalog-ipc-bridge.ts`
    (subscribe `onTurnsChanged`, hydrate with `getTurns` once), new
    `src/renderer/src/components/sidebar/worktree-list/rows/TaskTestTurnBadge.tsx` rendered by
    `TaskSectionHeader.tsx` next to `TaskSpotlightEnvPill`, tests next to the slice tests
    (`rg -l applySpotlightChanged src/renderer --glob '*.test.*'`).
  - **How**: event name `spotlight:turnsChanged`, payload `SpotlightAgentStatus` (task 3). Match
    on `task.taskKey` against `turns[].taskKey` (→ `Testing`) then `waiting[].taskKey`
    (→ `Waiting #n`, n = index + 1 among waiting of other tasks; the host's `position` is per
    pane, so derive from the order in `waiting`). Badge uses the shadcn `Badge` primitive from
    `components/ui/` with existing variants only (no restyle of a primitive, no raw palette
    colors, no computed `className` strings: `pnpm run check:code-quality:changed` gates it).
    Strings through `translate(...)`. Null `taskKey` → no badge. Keep `TaskSectionHeader.tsx`
    change to the one mount line.
  - **Verify**: `./node_modules/.bin/oxlint src/renderer/src/components/sidebar/worktree-list/rows/TaskTestTurnBadge.tsx src/renderer/src/store/slices/spotlight.ts && node node_modules/vitest/vitest.mjs run src/renderer/src/store/slices/spotlight.test.ts 2>&1 | tail -20` (use the real slice test path).
  - **Done when**: lint clean, slice tests cover `applySpotlightTurns` (set, equal snapshot skips
    the set), and a render test of the badge shows `Testing` for a holding task key, `Waiting #2`
    for the second waiter, nothing for an unknown key.

- [ ] **5. Harness hook: no test tool without the turn**
  - **What**: a PreToolUse Bash hook that blocks any segment running Playwright (`playwright` as
    a word, `*.playwright.mjs|py`, `--with playwright`), `maestro test`, `xcrun simctl io …
    recordVideo` or `adb … screenrecord` when the session's pane holds no test turn.
  - **Where**: `~/.claude/hooks/block-test-without-turn.sh` (new), `~/.claude/settings.json`
    (PreToolUse `Bash` list, after `block-install-in-worktree.sh`), one line in the Hooks
    section of `~/.claude/CLAUDE.md`. Arrecife space, project `.claude-global` in Engram.
  - **How**: `set -u`, source `bash-hook-lib.sh`, `hook_read_input`, `hook_each_segment`. Fast
    path: if no segment matches a test tool, `exit 0` before calling anything. Bypass
    `CLAUDE_ALLOW_TEST_WITHOUT_TURN=1` (env or inline, like `block-push.sh`). If `ORCA_PANE_KEY`
    is empty or `orca` is not on PATH → allow, one stderr line "not in an Orca terminal, no turn
    to check". Otherwise `orca spotlight status --json` (10 s cap with the lib's conventions; on
    error → allow with a stderr line) and read `.result.mine.kind` with `jq` (fallback: the
    lib's `hook_json_string` on `kind`). Missing `mine` (old host) → allow with a stderr line.
    `waiting`/`none` → `hook_block` with the message: run `orca spotlight on` first, your place in
    line is kept. Never block `orca spotlight …` itself. Bash 3.2 and BSD tools only.
  - **Verify**: `cd ~/.claude && for c in 'npx -y playwright@1.63 screenshot x' 'maestro test f.yaml' 'xcrun simctl io booted recordVideo a.mp4' 'adb shell screenrecord /sdcard/f.mp4' 'node e2e/login.playwright.mjs' 'ls'; do printf '{"tool_input":{"command":"%s"},"cwd":"/tmp"}' "$c" | ORCA_PANE_KEY= bash hooks/block-test-without-turn.sh; echo "$c -> $?"; done; printf '{"tool_input":{"command":"maestro test f.yaml"},"cwd":"/tmp"}' | ORCA_PANE_KEY=fake PATH=/usr/bin:/bin bash hooks/block-test-without-turn.sh; echo "no orca -> $?"`
  - **Done when**: every command exits 0 outside Orca (with the stderr note for the five test
    commands, none for `ls`), the no-`orca` case exits 0 with its note, and, run from an Orca
    terminal with no turn, `maestro test f.yaml` exits 2 with the block message while `orca
    spotlight status` exits 0.

- [ ] **6. Harness rules: take the turn, release between rounds, name the scripts**
  - **What**: the `verify` skill, the `tester` agent, the `spotlight` skill and the Spotlight
    lines of `~/.claude/CLAUDE.md` describe the global turn: `orca spotlight on` before any
    Playwright or Maestro run (mobile too, even with no Spotlight project), `orca spotlight off`
    at the end of each round before reporting, scripts named `*.playwright.mjs|py`, the hook's
    block message and what to do (`on`, wait, rerun).
  - **Where**: `~/.claude/skills/verify/SKILL.md` ("Spotlight first", "Mobile — Maestro", "The
    loop"), `~/.claude/agents/tester.md` (Procedure + Hard rules), `~/.claude/skills/spotlight/SKILL.md`
    (the `orca spotlight` bullets), `~/.claude/CLAUDE.md` (Spotlight section, one line).
  - **How**: edit only the sentences that change; no new sections; keep the existing voice. The
    tester releases with `off` in step 5 of its procedure (before the report) and takes it again
    at step 1 of the next round. The skill says a waiting `on` (exit 1) is rerun, never worked
    around. Stage only these four files when committing.
  - **Verify**: `cd ~/.claude && grep -c "orca spotlight off" skills/verify/SKILL.md agents/tester.md && grep -n "playwright\.\(mjs\|py\)" skills/verify/SKILL.md agents/tester.md | head && grep -n "whole machine\|toda la m" skills/spotlight/SKILL.md CLAUDE.md | head`
  - **Done when**: both files mention the release between rounds, the naming rule appears in the
    skill and the agent, and the spotlight skill and CLAUDE.md say the turn is global.

## Status

Plan written 2026-11-03; waiting for plan review and Juan's OK. Nothing built.

After the tasks: fast-forward orca-pro-max in the root, `/orca-update rebuild` (Juan's call),
then a live trial with two tasks of different repos: the second `on` must wait, the sidebar must
show `Testing` / `Waiting #1`, and `maestro test`/Playwright must be blocked in the waiting pane.

## Follow-ups (not in v1)

- Per-repo weight (a heavy frontend counting for two slots).
- Showing in the sidebar which pane holds the turn, for Juan to find the terminal.
