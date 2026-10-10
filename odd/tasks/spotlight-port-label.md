# Spotlight: the server's port on the row (Orca Pro Max)

Juan (2026-10-09): "podemos poner en algún lado el número del puerto que está corriendo, ej. 3007,
pequeño, para ver rápido". Today a task row says only `backend-action`. The server runs in the
repo root, so Orca's port scanner attributes its listener to the root worktree, not to the task
row that holds the Spotlight. The card shows ports only as a plug icon, and only on the row that
owns them.

## Decisions (Juan, 2026-10-09: "sí dale, mejóralo")

- **Real port, not the configured one.** Reuse Orca's workspace port scanner
  (`workspacePortScan`, `getWorkspacePortsByWorktreeId`, `WorktreeCardPorts`). Do not add a new
  detector. The backend has no configured port (`ax-dev-back` fixes 8080) and must still show it.
- **On the row that holds the Spotlight** (and on its root row under Servers): a small muted
  `:8080` next to the card's details. Several listeners show as `:3000 +1`. Nothing when the
  Spotlight is off or nothing listens.
- **Click** opens the existing ports details (open in browser, copy link, stop).
- **Board task cards:** each member row shows its repo's port the same way.

## Tasks

- [x] **1. Holder rows show the root's listening ports as a visible `:port` label** (coder; 8 test files / 113 tests, `pnpm tc:web` clean; the root row shows the label too; the label can lag up to the scanner's 30s interval)
  - Check: unit tests for merging the root's ports into the holder row (only while it holds the
    Spotlight; deduped; other rows untouched), the label text (`:3000`, `:3000 +1`, nothing), and
    the board member rows.

## Verification rule

Coder runs only its own test files (`--maxWorkers=2`) and `oxlint` on its files. The main session
runs `pnpm tc` once and commits. Rebuild only when Juan asks.
