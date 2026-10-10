# Arc space links

Orca Pro Max only. Links Orca sends to the system browser open in the Arc space that
matches the Orca space of the workspace they came from.

## Decisions (Juan, 2026-10-10)

- **Opt-in, off by default.** Nothing changes for anyone who doesn't turn it on (Juan
  wants to share Orca with coworkers who may not use Arc). Each person writes their own
  Arc space names.
- **macOS only.** The switch shows only on Mac; Windows and Linux open as always.
- **Juan's mapping:** Action Black → `Action`, Personal → `Personal`, Arctic Grey →
  `Bulbasour`.
- **Where the mapping lives:** client settings (`GlobalSettings`), not on the project
  group. Arc runs on the client Mac, so no RPC or remote-host wire change. Key: the
  space's top-level group id.
- **UI:** Settings → Browser, one switch "Open links in Arc spaces". When on, one text
  field per space. Empty field = that space opens as always.
- **Which space a link belongs to:** the worktree's repo (or folder workspace) → its
  top-level group. No group (floating terminal, ungrouped project) → the active space.
- **Fallback to `shell.openExternal`** when: the setting is off, not macOS, no Arc
  name, Arc is not installed, or the AppleScript fails (unknown space name, no Arc
  window, Automation permission denied, timeout).
- **AppleScript** (`osascript`, URL and space name passed as argv, never interpolated):
  activate Arc, `tell front window` → `tell space <name>` → `focus` →
  `make new tab with properties {URL: <url>}`. First use shows macOS's "Orca wants to
  control Arc" prompt (the app already ships `NSAppleEventsUsageDescription` and the
  apple-events entitlement).
- **Scope v1:** every link that goes through `openHttpLink` (terminal, markdown, chat,
  checks panel). Direct `window.api.shell.openUrl` callers (sidebar card PR links,
  browser tab "open in browser") stay as they are; follow-up if Juan wants them.

## Tasks

- [x] **1. Main: open a URL in an Arc space**
  - Settings: `openLinksInArcSpaces?: boolean` and
    `arcSpaceNameBySidebarSpaceId?: Record<string, string>` in `global-settings-types.ts`,
    defaults `false` / `{}`.
  - `src/main/arc-space-url-open.ts`: `openUrlInArcSpace(url, spaceName)`; true only
    when osascript exits 0. Checks macOS and that Arc is installed first.
  - `shell:openUrl` accepts an optional `{ arcSpace }`; it uses Arc only when the
    setting is on, then falls back to `shell.openExternal`. Preload and `ShellApi` get
    the optional argument; the web shell ignores it.
  - Check: `src/main/arc-space-url-open.test.ts` and
    `src/main/ipc/shell-open-url.test.ts` (own file: `shell.test.ts` is near the
    800-line test cap).
  - Done: commit `ec4b853abd`. Tests and `pnpm tc` pass.
- [x] **2. Renderer: links pick their space's Arc space**
  - `sidebar-space-scope.ts`: export the worktree → top-level group lookup.
  - `src/renderer/src/lib/arc-space-link-target.ts`: `resolveArcSpaceForWorktree`
    (setting on + a name for the space; active space as the fallback). The macOS
    check lives in main only.
  - `openHttpLink` passes `{ arcSpace }` on its system-browser branch.
  - Check: `arc-space-link-target.test.ts` and `http-link-arc-space-routing.test.ts`
    (own file, same reason).
  - Done: commit `9cc1e5ecc2`. Tests and `pnpm tc` pass.
- [x] **3. Settings UI**
  - `BrowserArcSpacesSetting.tsx` in Settings → Browser (Mac only): switch plus one
    field per space; a settings-search entry.
  - Check: `BrowserArcSpacesSetting.test.tsx`.
  - Done: commit `e0c2332512`, plus `dda30665e0` for the Browser search order test.
    Tests and `pnpm tc` pass.

Verified on 2026-10-10, after merging upstream (`cef100fbd6`): the test files above
pass and `pnpm tc` is clean. The AppleScript ran against Juan's real Arc in all three
spaces: the space takes focus and the new tab opens there.
