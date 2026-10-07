import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { inspectPackageManagerSetupCandidate } from '../../shared/setup-script-package-manager-suggestion'
import {
  emptySpotlightServerScriptDetection,
  SPOTLIGHT_SERVER_ENVS,
  type SpotlightServerScriptDetection
} from '../../shared/spotlight-server-types'

const PACKAGE_JSON = 'package.json'
// Same cap as repo-icon-autodetect: a bigger package.json is not a normal project manifest.
const PACKAGE_JSON_MAX_BYTES = 128 * 1024
const MAX_SCRIPT_SUGGESTIONS = 50
const SERVER_SCRIPT_PREFIXES = ['dev', 'local', 'prod', 'start']
// Why: suggested commands are typed into a terminal, so a script name with shell syntax is skipped.
const SAFE_SCRIPT_NAME = /^[A-Za-z0-9_][A-Za-z0-9_:.-]*$/

type ScriptRunner = 'pnpm' | 'yarn' | 'bun' | 'npm'

function isScriptRunner(value: string | undefined): value is ScriptRunner {
  return value === 'pnpm' || value === 'yarn' || value === 'bun' || value === 'npm'
}

function buildScriptCommand(runner: ScriptRunner, script: string): string {
  switch (runner) {
    case 'pnpm':
    case 'yarn':
      return `${runner} ${script}`
    case 'bun':
      return `bun run ${script}`
    case 'npm':
      // The trailing `--` makes the `--port N` Orca appends reach the script.
      return `npm run ${script} --`
  }
}

async function readPackageJsonText(repoRoot: string): Promise<string | null> {
  try {
    const packageJsonPath = join(repoRoot, PACKAGE_JSON)
    const info = await stat(packageJsonPath)
    if (!info.isFile() || info.size > PACKAGE_JSON_MAX_BYTES) {
      return null
    }
    return await readFile(packageJsonPath, 'utf8')
  } catch {
    return null
  }
}

async function fileExists(repoRoot: string, relativePath: string): Promise<boolean> {
  try {
    return (await stat(join(repoRoot, relativePath))).isFile()
  } catch {
    return false
  }
}

function parseScriptNames(packageJsonText: string): string[] {
  try {
    const parsed: unknown = JSON.parse(packageJsonText)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return []
    }
    const scripts: unknown = Reflect.get(parsed, 'scripts')
    if (typeof scripts !== 'object' || scripts === null || Array.isArray(scripts)) {
      return []
    }
    return Object.keys(scripts)
  } catch {
    return []
  }
}

/** Reads the repo root's package.json scripts into per-environment server commands. Never throws. */
export async function detectSpotlightServerScripts(
  repoRoot: string
): Promise<SpotlightServerScriptDetection> {
  const result = emptySpotlightServerScriptDetection()
  const packageJsonText = await readPackageJsonText(repoRoot)
  if (packageJsonText === null) {
    return result
  }
  const scriptNames = parseScriptNames(packageJsonText)
  if (scriptNames.length === 0) {
    return result
  }
  // The package.json was already read under the size cap, so the shared inspector reuses that text.
  const candidate = await inspectPackageManagerSetupCandidate(
    async (relativePath) => (relativePath === PACKAGE_JSON ? packageJsonText : null),
    (relativePath) => fileExists(repoRoot, relativePath)
  )
  // `setup` is `<manager> install`, so its first word names the package manager.
  const runner = candidate?.setup.split(' ')[0]
  if (!isScriptRunner(runner)) {
    return result
  }

  const names = new Set(scriptNames)
  for (const env of SPOTLIGHT_SERVER_ENVS) {
    if (names.has(env)) {
      result.detected[env] = buildScriptCommand(runner, env)
    }
  }
  result.scriptCommands = scriptNames
    .filter(
      (name) =>
        SAFE_SCRIPT_NAME.test(name) &&
        SERVER_SCRIPT_PREFIXES.some((prefix) => name.startsWith(prefix))
    )
    .sort()
    .slice(0, MAX_SCRIPT_SUGGESTIONS)
    .map((name) => buildScriptCommand(runner, name))
  return result
}
