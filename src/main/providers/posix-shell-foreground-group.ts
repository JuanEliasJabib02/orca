// Whether a POSIX PTY's own shell owns its terminal's foreground, read from one process-table capture.
import { getFirstCommandToken } from '../../shared/command-token-scanner'
import { collectDescendantsFromIndex, getProcessTableIndex } from '../../shared/process-table-index'
import type { ProcessTableRow } from '../../shared/process-table-snapshot'
import { isShellProcess } from '../../shared/shell-process-detection'
import type { PtyForegroundGroup } from '../../shared/terminal-process-inspection'

function runsShell(row: ProcessTableRow): boolean {
  // Login shells report as `-zsh` / `-/bin/zsh`.
  return isShellProcess(getFirstCommandToken(row.command).replace(/^-/, ''))
}

/**
 * Compares the tty's foreground group (`tpgid`) with the shell's own group (`pgid`). The shell is
 * the shallowest shell in the tree under the PTY's spawned pid, which skips a wrapper root (macOS
 * `login`) and stays above any `sh`/`bash` script it runs. Null when the capture can't tell.
 */
export function resolvePtyForegroundGroup(
  rows: readonly ProcessTableRow[],
  rootPid: number
): PtyForegroundGroup | null {
  const index = getProcessTableIndex(rows)
  const root = index.byPid.get(rootPid)
  if (!root) {
    return null
  }
  const tree = [{ ...root, depth: 0 }, ...collectDescendantsFromIndex(index, rootPid)]
  const shell = tree.filter(runsShell).sort((left, right) => left.depth - right.depth)[0]
  if (!shell || shell.pgid === undefined || shell.tpgid === undefined || shell.tpgid <= 0) {
    return null
  }
  // A stopped job keeps its server (and port) while the prompt is back.
  if (tree.some((row) => row.depth > 0 && row.stat.includes('T'))) {
    return 'job'
  }
  return shell.tpgid === shell.pgid ? 'shell' : 'job'
}
