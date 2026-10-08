// The Spotlight log mirror's view of its terminal: the runtime's per-PTY data feed plus its
// subscriber-driven attach, since the daemon only streams sessions a mounted pane (or this) attached.

/** The slice of the Orca runtime the Spotlight log mirror needs. */
export type SpotlightTerminalOutputSource = {
  subscribeToTerminalData: (ptyId: string, listener: (data: string) => void) => () => void
  registerTerminalOutputObserver: (ptyId: string) => () => void
}

let outputSource: SpotlightTerminalOutputSource | null = null

export function configureSpotlightTerminalOutputSource(
  source: SpotlightTerminalOutputSource | null
): void {
  outputSource = source
}

/** Feed `onData` with the PTY's output, mounted pane or not. Returns an idempotent release. */
export function observeSpotlightTerminalOutput(
  ptyId: string,
  onData: (data: string) => void
): () => void {
  const source = outputSource
  if (!source) {
    return () => {}
  }
  const unsubscribe = source.subscribeToTerminalData(ptyId, (data) => onData(data))
  // Why subscribe first: attached bytes can arrive before the attach reply does.
  const releaseObserver = source.registerTerminalOutputObserver(ptyId)
  let released = false
  return () => {
    if (released) {
      return
    }
    released = true
    releaseObserver()
    unsubscribe()
  }
}
