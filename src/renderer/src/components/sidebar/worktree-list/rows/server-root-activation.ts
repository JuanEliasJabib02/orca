import { selectSpotlightTerminalTab } from '@/lib/open-spotlight-terminal-tab'
import { SERVERS_LANE_KEY } from '../grouping/server-root-lane'

// Why a cache: the card is memoized, so each root must get the same handler on every render.
const handlerByWorktreeId = new Map<string, () => void>()

/**
 * The card's `onActivate` for a row: in Group by → Task's Servers section, opening a root also
 * puts it on its Spotlight terminal, where its server's log is. Undefined everywhere else.
 */
export function getServerRootActivateHandler(
  sectionKey: string,
  worktreeId: string
): (() => void) | undefined {
  if (sectionKey !== SERVERS_LANE_KEY) {
    return undefined
  }
  let handler = handlerByWorktreeId.get(worktreeId)
  if (!handler) {
    handler = () => {
      selectSpotlightTerminalTab(worktreeId)
    }
    handlerByWorktreeId.set(worktreeId, handler)
  }
  return handler
}
