import { z } from 'zod'
import { OptionalPositiveInt, requiredString } from './rpc-param-primitives'

export const SpotlightOnParams = z.object({
  /** The caller's worktree id (`ORCA_WORKTREE_ID`); its task decides the projects. */
  worktree: requiredString('Missing worktree: run this inside an Orca workspace terminal'),
  /** The caller's pane (`ORCA_PANE_KEY`); the turn and the place in line belong to it. */
  paneKey: requiredString('Missing pane: run this inside an Orca terminal'),
  timeoutMs: OptionalPositiveInt
})

export const SpotlightOffParams = z.object({
  paneKey: requiredString('Missing pane: run this inside an Orca terminal')
})
