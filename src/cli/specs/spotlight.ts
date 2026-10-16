import type { CommandSpec } from '../args'
import { GLOBAL_FLAGS } from '../args'

export const SPOTLIGHT_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['spotlight', 'on'],
    summary: "Light your task's Spotlight to test it, waiting in line if another task is testing",
    usage: 'orca spotlight on [--timeout-ms <ms>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'timeout-ms'],
    notes: [
      "Run it inside the Orca terminal of the workspace you're testing: every project of its task gets the Spotlight (its code on the project root) and its dev server, like the task's Spotlight button.",
      'Waits for your turn when another task holds one of those projects, then for the servers to listen, up to --timeout-ms (default 100000). Exits 1 while still waiting: run it again to keep waiting; your place in line is kept.',
      'Prints each server URL and its log file. Run `orca spotlight off` when you finish testing; finishing your agent turn or closing the terminal also gives the turn back.'
    ],
    examples: ['orca spotlight on', 'orca spotlight on --timeout-ms 300000']
  },
  {
    path: ['spotlight', 'off'],
    summary: 'Give your Spotlight turn back so the next task can test',
    usage: 'orca spotlight off [--json]',
    allowedFlags: [...GLOBAL_FLAGS],
    notes: [
      'Nothing is turned off: the servers keep running for whoever looks next, until another task takes the projects.'
    ],
    examples: ['orca spotlight off']
  },
  {
    path: ['spotlight', 'status'],
    summary: 'Show which tasks hold Spotlight turns, who is waiting, and what each root runs',
    usage: 'orca spotlight status [--json]',
    allowedFlags: [...GLOBAL_FLAGS],
    examples: ['orca spotlight status', 'orca spotlight status --json']
  }
]
