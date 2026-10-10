// Which command a Spotlight activation runs: the repo's command for the task environment, with the
// task's variant filled in when the command holds `{variant}`.
import { useAppStore } from '@/store'
import { resolveSpotlightServerCommandTemplate } from '../../../shared/spotlight-server-command'
import type {
  SpotlightServerEnv,
  SpotlightServerScriptDetection
} from '../../../shared/spotlight-server-types'
import {
  fillSpotlightVariant,
  isSafeSpotlightVariant,
  noSpotlightVariantInference,
  spotlightCommandNeedsVariant,
  type SpotlightVariantInference
} from '../../../shared/spotlight-server-variant'
import type { Worktree } from '../../../shared/worktree/types'
import { getSpotlightEnvForTask } from '@/store/slices/ui/ui-slice-spotlight-env-actions'
import { getSpotlightVariantForTaskRepo } from '@/store/slices/ui/ui-slice-spotlight-variant-actions'
import { getSpotlightEnvKey } from '@/lib/spotlight-env-key'

/** At most this many buttons in the variant prompt; the row's tag menu lists every variant. */
export const MAX_SPOTLIGHT_VARIANT_PROMPT_CHOICES = 6

export type SpotlightActivationCommandPlan =
  | { kind: 'command'; command: string }
  /** Nothing starts: no command for `env`, or (`env` null) one needs a variant none can fill. */
  | { kind: 'none'; env: SpotlightServerEnv | null }
  /** The command needs a variant nobody chose and the branch doesn't tell: ask among these. */
  | { kind: 'ask-variant'; candidates: string[] }

const NO_VARIANT: SpotlightActivationCommandPlan = { kind: 'none', env: null }

// Why every repo: a branch-name task is only a task when it spans 2+ repos, like in the sidebar.
export function listAllWorktrees(): Worktree[] {
  return Object.values(useAppStore.getState().worktreesByRepo)
    .flat()
    .filter((entry) => !entry.isArchived)
}

async function detectServerScripts(
  repoId: string
): Promise<SpotlightServerScriptDetection | undefined> {
  try {
    return await window.api.repos.detectSpotlightServerScripts({ repoId })
  } catch (error) {
    console.warn('[spotlight] Server script detection failed:', error)
    return undefined
  }
}

async function inferVariant(
  repoId: string,
  worktreeId: string
): Promise<SpotlightVariantInference> {
  try {
    return await window.api.spotlight.inferServerVariant({ repoId, worktreeId })
  } catch (error) {
    console.warn('[spotlight] Could not infer the server variant:', error)
    return noSpotlightVariantInference()
  }
}

/** Remembered for the task first, then what the branch changed (remembered from then on). */
async function pickVariant(args: {
  repoId: string
  worktreeId: string
  envKey: string | null
  variants: readonly string[]
}): Promise<{ variant: string } | { candidates: string[] }> {
  const { repoId, worktreeId, envKey, variants } = args
  // Why accept any safe one while detection is unknown: a failed detection must not drop a choice.
  const isKnown = (variant: string): boolean => variants.length === 0 || variants.includes(variant)
  const state = useAppStore.getState()
  const remembered = getSpotlightVariantForTaskRepo(
    state.spotlightVariantByTaskRepo,
    envKey,
    repoId
  )
  if (remembered && isKnown(remembered)) {
    return { variant: remembered }
  }
  const inference = await inferVariant(repoId, worktreeId)
  if (
    inference.kind === 'inferred' &&
    isSafeSpotlightVariant(inference.variant) &&
    isKnown(inference.variant)
  ) {
    if (envKey !== null) {
      useAppStore.getState().setSpotlightVariantForTaskRepo(envKey, repoId, inference.variant)
    }
    return { variant: inference.variant }
  }
  const touched = inference.kind === 'ambiguous' ? inference.candidates.filter(isKnown) : []
  return {
    candidates: (touched.length > 0 ? touched : [...variants]).slice(
      0,
      MAX_SPOTLIGHT_VARIANT_PROMPT_CHOICES
    )
  }
}

/** The activated worktree's server command: repo config, else detected scripts, in the environment
 *  of its task (or of the workspace itself when it has none). `none` when the repo isn't started
 *  there (e.g. the backend in Dev). `chosenVariant` is a pick the user just made. */
export async function planSpotlightActivationCommand(
  repoId: string,
  worktreeId: string,
  chosenVariant?: string
): Promise<SpotlightActivationCommandPlan> {
  const state = useAppStore.getState()
  const worktree = state.worktreesByRepo[repoId]?.find((entry) => entry.id === worktreeId)
  const envKey = worktree ? getSpotlightEnvKey(worktree, listAllWorktrees()) : null
  const env = getSpotlightEnvForTask(state.spotlightEnvByTaskKey, envKey)
  const repo = state.repos.find((entry) => entry.id === repoId)
  if (!repo) {
    return { kind: 'none', env }
  }
  const detection = await detectServerScripts(repoId)
  const template = resolveSpotlightServerCommandTemplate({
    config: repo.spotlightServer,
    detected: detection?.detected,
    env
  })
  if (template === null) {
    return { kind: 'none', env }
  }
  if (!spotlightCommandNeedsVariant(template)) {
    return { kind: 'command', command: template }
  }
  const picked = isSafeSpotlightVariant(chosenVariant)
    ? { variant: chosenVariant }
    : await pickVariant({ repoId, worktreeId, envKey, variants: detection?.variants ?? [] })
  if ('candidates' in picked) {
    // Nothing to offer means nothing can start; never type a literal `{variant}`.
    return picked.candidates.length > 0 ? { kind: 'ask-variant', ...picked } : NO_VARIANT
  }
  const command = fillSpotlightVariant(template, picked.variant)
  return command === null ? NO_VARIANT : { kind: 'command', command }
}

/** The command only; null when nothing would start without asking first. */
export async function resolveSpotlightActivationCommand(
  repoId: string,
  worktreeId: string
): Promise<string | null> {
  const plan = await planSpotlightActivationCommand(repoId, worktreeId)
  return plan.kind === 'command' ? plan.command : null
}
