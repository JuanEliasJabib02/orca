// Same as config/scripts/build-mac-local.mjs, but packages arm64 only (x64 native variants aren't installed).
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'

const { getLocalBuildIdentity } = await import(
  pathToFileURL(resolve('config/scripts/build-mac-local.mjs')).href
)
const identity = getLocalBuildIdentity()
console.log(`[package-arm64] local update version ${identity.version}`)
execFileSync(
  'pnpm',
  ['exec', 'electron-builder', '--config', 'config/electron-builder.config.cjs', '--mac', '--arm64'],
  {
    env: { ...process.env, ORCA_BUILD_COMMIT: identity.commit, ORCA_LOCAL_BUILD_VERSION: identity.version },
    stdio: 'inherit'
  }
)
