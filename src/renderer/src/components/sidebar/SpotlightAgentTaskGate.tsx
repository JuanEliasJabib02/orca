import { useEffect } from 'react'
import { registerSpotlightAgentTaskRequests } from '@/lib/spotlight-agent-task-requests'

/** Answers main when an agent asks for its task's Spotlight (`orca spotlight on`). Renders null. */
export default function SpotlightAgentTaskGate(): null {
  useEffect(() => {
    const unsubs: (() => void)[] = []
    registerSpotlightAgentTaskRequests(unsubs)
    return () => unsubs.forEach((unsub) => unsub())
  }, [])
  return null
}
