---
name: orca-update
description: "Update Orca Pro Max (Juan's fork of stablyai/orca) with upstream main, verify it, rebuild the macOS app and reinstall it. Trigger: 'actualiza orca', 'git pull origin main en orca', 'trae lo último de orca', 'haz el rebuild de orca', 'reinstala orca'. Usage: /orca-update [all|pull|rebuild] (default all)."
---

# Update and rebuild Orca Pro Max

Juan runs his own build of Orca, "Orca Pro Max". It's a fork of `stablyai/orca` with his own
features: Spotlight dev servers, sidebar spaces, Group by Task, the task board, Servers, port
labels, the One Dark theme, line blame, and more. This skill brings upstream's `main` into the
fork, checks that nothing broke, builds the arm64 app and swaps it into `/Applications`.

## Modes

| Mode | Does |
|---|---|
| `all` (default) | merge upstream → install deps → verify → rebuild → reinstall |
| `pull` | merge upstream → install deps → verify (no rebuild) |
| `rebuild` | rebuild the current fork branch → reinstall (no merge) |

Invoking the skill is Juan's go-ahead for the merge, the rebuild and the restart. **Push stays
his call:** ask at the end. Push only to the `fork` remote, never to `origin`.

## Where things are

- **ROOT:** `~/Desktop/Software/Sideprojects/orca`, on branch `orca-pro-max`.
  - It has the real `node_modules`; Orca worktrees symlink theirs to it.
  - It is where installs, verification and builds run.
- **FORK_BRANCH:** the branch of the Orca worktree this session runs in, if it's one of the orca
  worktrees (`~/orca/workspaces/orca/<name>`). Otherwise use `orca-pro-max` and work in ROOT.
  - `orca-pro-max` must be an ancestor of FORK_BRANCH (`git merge-base --is-ancestor`), so ROOT
    can fast-forward to it. If it isn't, stop and ask Juan.
- **Remotes:** `origin` = stablyai/orca (upstream, never push); `fork` =
  JuanEliasJabib02/orca.
- **App:** `/Applications/Orca Pro Max.app`, profile "Orca Dev"
  (`~/Library/Application Support/Orca Dev`).
- **Scripts:** in this skill's `scripts/`, tracked on `orca-pro-max`. Run ROOT's copy
  (`$ROOT/.claude/skills/orca-update/scripts/`), which is the one ROOT just fast-forwarded to.
  - `package-arm64.mjs` runs electron-builder for arm64 only.
  - `install-opm-swap-first.py` swaps the app and keeps one backup.

## 0. Preflight

```bash
ROOT=~/Desktop/Software/Sideprojects/orca
git -C "$ROOT" status --short          # must be empty
git status --short                     # the worktree: must be empty; if not, ask Juan before merging
git -C "$ROOT" rev-parse --abbrev-ref HEAD   # orca-pro-max
```

## 1. Merge upstream (`all`, `pull`)

1. `git fetch origin main`. Report how many commits upstream is ahead
   (`git rev-list --count HEAD..origin/main`) and how many are the fork's own.
2. In the worktree on FORK_BRANCH, run `git merge --no-commit --no-ff origin/main`. Always merge,
   never rebase; the fork has merged upstream this way every time.
3. List the conflicts: `git diff --name-only --diff-filter=U`. Also look for modify/delete lines in
   the merge output.
4. Resolve them. If there are more than a handful, delegate to a `coder` with `model: opus`. The
   rule for every conflict: **keep upstream's change and keep the fork's feature.**
   - Understand each side first: `git log --oneline origin/main..HEAD -- <file>` for the fork,
     and the upstream diff from the merge-base.
   - If upstream moved, renamed or deleted code the fork changed, port the fork's change to the
     new place. Then `git rm` the old path.
   - `pnpm-lock.yaml`: take theirs, then run `pnpm install --lockfile-only` only if the fork adds
     dependencies to `package.json`. This doesn't touch `node_modules`.
   - Locale JSONs and allowlists: the union of keys. Where both sides have a key, upstream's text
     wins.
   - Tests: keep both sides' cases.
   - A file the merge pushes over max-lines: split it into a well-named module. Never disable
     the rule.
5. Run `./node_modules/.bin/oxlint` on every file touched. Then commit with `--no-verify` and the
   message `Merge remote-tracking branch 'origin/main' into <FORK_BRANCH>`.
   - Why `--no-verify`: the husky hook runs `pnpm exec`, and pnpm 12 tries to install into the
     worktree's symlinked `node_modules` and fails.

## 2. Install dependencies (`all`, `pull`)

```bash
git -C "$ROOT" merge --ff-only <FORK_BRANCH>
cd "$ROOT" && pnpm install --frozen-lockfile
```

- If pnpm says "Failed to switch pnpm to vX", its auto-switch left a text shim. Finish that
  version's install with
  `node install.js` in `~/Library/pnpm/.tools/@pnpm+exe/<ver>*/node_modules/@pnpm/exe/`. The
  version symlink points to a `<ver>_tmp_*` folder.
- Never install in a worktree.

## 3. Verify (`all`, `pull`)

Run everything in ROOT: it has a real `node_modules`, and pnpm refuses to run scripts in a
worktree.

```bash
cd "$ROOT"
pnpm tc
git diff --name-only origin/main HEAD | grep -E '\.test\.tsx?$' | while read f; do [ -f "$f" ] && echo "$f"; done > /tmp/orca-fork-tests.txt
ORCA_BACKGROUND_LAUNCH=1 ORCA_TEST_NODE_EXECUTABLE=$(which node) ORCA_TEST_NODE_VERSION=$(node -p process.versions.node) \
  node node_modules/vitest/vitest.mjs run --config config/vitest.config.ts --maxWorkers=3 $(cat /tmp/orca-fork-tests.txt)
```

- Vitest runs under node because upstream's `pnpm test` wrapper needs Bun
  (`config/.bun-version`), which may not be installed.
- The test list is the fork's own test files, the ones that differ from upstream.
- **Type errors after a merge are integration gaps.** Upstream code doesn't know fork pieces
  yet: a new required field on RPC methods, a provider rewritten without the fork's methods, a
  new persisted model missing a fork field.
  - Fix them in the worktree, with a `coder` on `opus` for anything beyond a few lines.
  - Commit as `fix: reconnect fork features to upstream after the merge` (with `--no-verify`, after
    oxlint), then fast-forward ROOT again.
- **Watch persisted fields.** A fork field that upstream's new persistence silently drops breaks
  things after a restart without any type error, e.g. `TerminalTab.spotlightRepoRoot`. Check
  they round-trip.
- **Known failure from before:** `line-blame-request.test.ts` leaves an unhandled rejection. It's
  a test-isolation bug in the fork, not caused by the merge.

## 4. Rebuild (`all`, `rebuild`)

```bash
cd "$ROOT"
pnpm run build:desktop && pnpm run build:computer-macos && pnpm run build:keyboard-layout-macos \
  && pnpm run build:notification-status-macos && pnpm run ensure:electron-runtime \
  && node .claude/skills/orca-update/scripts/package-arm64.mjs
```

- Run it in the background and wait for the notification.
- **`pnpm build:mac` doesn't work here.** It also packages x64, and the x64 native variants
  aren't installed.
- **The x64 error at the end is expected.** `package-arm64.mjs` still ends with
  "Packaging darwin/x64 requires native variants…"; the arm64 app is already packaged and
  signed by then.
- **The real check is the app itself:**
  - the version must end in the short sha of the HEAD you built:
    `/usr/libexec/PlistBuddy -c 'Print CFBundleShortVersionString' "$ROOT/dist/mac-arm64/Orca Pro Max.app/Contents/Info.plist"`;
  - `Contents/Resources/app.asar` must have a fresh timestamp.

## 5. Reinstall (`all`, `rebuild`)

```bash
nohup python3 ~/Desktop/Software/Sideprojects/orca/.claude/skills/orca-update/scripts/install-opm-swap-first.py >/dev/null 2>&1 & disown
```

- It waits 30s so you can send your reply first, because the session lives inside Orca's
  terminal.
- It keeps ONE backup, `~/Desktop/Orca Pro Max (anterior).app`, replacing the previous one. That
  is Juan's rollback: drag it back to `/Applications`.
- It copies the new build, quits Orca and reopens it.
- Terminals and running agents survive: they live in the terminal daemon, which doesn't restart
  with the app.
- Log: `~/Library/Logs/orca-update-install.log`.

## 6. Report (Spanish, plain words)

- What came in: how many upstream commits, and up to which one.
- Conflicts: how many, and the notable ports.
- Verification: typecheck, tests (files and tests), known failures.
- Commits made.
- Installed version, and where the backup is.
- Ask whether to push FORK_BRANCH and `orca-pro-max` to `fork`.

Save the outcome to Engram (project `orca`, topic `orca/upstream-sync`), including any new gotcha.
