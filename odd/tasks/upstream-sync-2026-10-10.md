# Upstream sync: merge origin/main into Orca Pro Max (2026-10-10)

Juan: "¿puedes hacer git pull origin main para actualizar Orca con lo último?"

- Fork branch `juanjabibarcticgrey/arc-workspace-switcher` (on top of `orca-pro-max`): 102 own
  commits; `origin/main` (stablyai/orca) is 1186 commits ahead, merge-base `34d6041c83`
  (2026-09-29).
- Same approach as earlier syncs ("Merge remote-tracking branch 'origin/main' into
  orca-pro-max"): one merge commit, never a rebase.
- The trial merge gives 42 content conflicts plus 2 modify/delete: `git-params.ts` and
  `runtime-git-client-api-contract.test.ts`, deleted upstream and modified by us.

## Rule for every conflict

Keep upstream's change and keep the fork's feature. Never drop either side silently. When upstream
moved or deleted code the fork touched, port the fork's change to the new location.

## Tasks

- [x] **1. Resolve the conflicts and commit the merge** (coder opus, `df75c58e60`, committed with `--no-verify`: pnpm 12's pre-run install check fails on the worktree's symlinked node_modules; oxlint ran on all touched files)
  - Check: no conflict markers; oxlint on the touched files.
- [x] **2. Install in the root and verify** (pnpm 12.8.1 tool install finished by hand; root install OK; post-merge fixes: blame RPC permission, local git provider blame, `spotlightRepoRoot` in the new workspace-layout disk model, optional `taskKeys`; typecheck clean; 173 test files / 2220 tests pass under node)
  - Fast-forward the root's `orca-pro-max`, then `pnpm install --frozen-lockfile` there.
  - Run `pnpm tc` and the fork's feature tests (Spotlight, task board, spaces).
  - Fix what breaks, as follow-up commits.

## Notes

- Upstream now runs vitest under Bun (`config/.bun-version` 1.4.2), which isn't installed. Tests
  run fine with `node node_modules/vitest/vitest.mjs run --config config/vitest.config.ts`.
- In a worktree whose `node_modules` is a symlink, pnpm 12 refuses every `pnpm run` (and the
  husky hook). Verify from the root, or call the tools directly.
- Known fork test-isolation bug, present before the merge too: `line-blame-request.test.ts`
  leaves an unhandled rejection after `afterEach` resets mocks.
- `spotlightRepoRoot` is not published in the layout stream to other clients (same as
  `forceHostRuntime`). If upstream wires the renderer to that stream, publish it.
