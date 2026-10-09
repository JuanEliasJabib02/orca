import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { SPOTLIGHT_SERVER_ENVS, type SpotlightServerEnv } from '../../shared/spotlight-server-types'
import {
  isSafeSpotlightVariant,
  SPOTLIGHT_VARIANT_PLACEHOLDER
} from '../../shared/spotlight-server-variant'

/** Monorepo folder whose `<V>` subfolders are the apps a variant runs (landing's `apps/DO`). */
export const SPOTLIGHT_VARIANT_APPS_DIR = 'apps'

const VARIANT_SCRIPT_PREFIX = 'dev:'
const MAX_SPOTLIGHT_VARIANTS = 50
// Bounds the folder listing; a real apps/ folder holds a handful of apps.
const MAX_APP_DIR_ENTRIES = 1000

/** Lowercased names of the folders under `apps/`, or null when the repo has no `apps/` folder. */
export async function readSpotlightAppDirNames(repoRoot: string): Promise<Set<string> | null> {
  try {
    const entries = await readdir(join(repoRoot, SPOTLIGHT_VARIANT_APPS_DIR), {
      withFileTypes: true
    })
    const names = new Set<string>()
    for (const entry of entries.slice(0, MAX_APP_DIR_ENTRIES)) {
      if (entry.isDirectory()) {
        names.add(entry.name.toLowerCase())
      }
    }
    return names
  } catch {
    return null
  }
}

function variantCodes(scriptNames: readonly string[]): string[] {
  const codes = new Map<string, string>()
  for (const name of scriptNames) {
    if (!name.startsWith(VARIANT_SCRIPT_PREFIX)) {
      continue
    }
    const code = name.slice(VARIANT_SCRIPT_PREFIX.length)
    // Why case-insensitive: `dev:do` and `dev:DO` would run the same app twice in the list.
    if (isSafeSpotlightVariant(code) && !codes.has(code.toLowerCase())) {
      codes.set(code.toLowerCase(), code)
    }
  }
  return [...codes.values()]
}

/**
 * Codes `<v>` of the repo's `dev:<v>` scripts that pick one app to serve. With an `apps/` folder only
 * codes with an `apps/<V>` app count (stale scripts drop out). Empty when the repo has a plain `dev`
 * script (its `dev:*` siblings are helpers) or fewer than two codes (no choice to make). Never throws.
 */
export async function detectSpotlightServerVariants(
  repoRoot: string,
  scriptNames: readonly string[]
): Promise<string[]> {
  if (scriptNames.includes('dev')) {
    return []
  }
  const codes = variantCodes(scriptNames)
  if (codes.length < 2) {
    return []
  }
  const appDirs = await readSpotlightAppDirNames(repoRoot)
  const variants =
    appDirs === null ? codes : codes.filter((code) => appDirs.has(code.toLowerCase()))
  return variants.length >= 2 ? variants.sort().slice(0, MAX_SPOTLIGHT_VARIANTS) : []
}

/** The `<env>:{variant}` script name for each environment some variant has a script for. */
export function spotlightVariantScriptTemplates(
  scriptNames: readonly string[],
  variants: readonly string[]
): Partial<Record<SpotlightServerEnv, string>> {
  const names = new Set(scriptNames)
  const templates: Partial<Record<SpotlightServerEnv, string>> = {}
  for (const env of SPOTLIGHT_SERVER_ENVS) {
    if (variants.some((variant) => names.has(`${env}:${variant}`))) {
      templates[env] = `${env}:${SPOTLIGHT_VARIANT_PLACEHOLDER}`
    }
  }
  return templates
}
