'use strict'

/**
 * Stage the native notch companion app (apps/notch) for electron-builder
 * packaging, mirroring stage-native-deps.cjs's pattern: copy the built
 * artifact into apps/desktop/build/<name>/, ship it via extraResources.
 *
 * The notch is macOS-only and genuinely optional — `notch.cjs` already
 * handles its absence gracefully (the app just runs without the notch
 * companion, same as an unbuilt dev checkout). So unlike stage-native-deps
 * (a hard requirement), this script is best-effort everywhere:
 *   - non-macOS: no-op, exit 0.
 *   - macOS but the notch hasn't been built: warn with the fix command,
 *     exit 0. A `npm run build` on a fresh checkout shouldn't hard-fail
 *     just because nobody ran `npm run notch:build` yet.
 *
 * Prefers the Release configuration (what a real distribution should ship)
 * but falls back to Debug so `npm run pack` works against a dev-only build
 * without requiring a separate Release build first.
 *
 * Runs as part of `npm run build`, right after stage-native-deps.
 */

const fs = require('node:fs')
const path = require('node:path')

const APP_ROOT = path.resolve(__dirname, '..')
const REPO_ROOT = path.resolve(APP_ROOT, '..', '..')
const NOTCH_ROOT = path.join(REPO_ROOT, 'apps', 'notch')
// electron-builder's extraResources requires the "from" path to exist, so
// this directory is always created (possibly empty) and the whole directory
// — not the bundle path directly — is what package.json's extraResources
// entry points at. An empty directory copies zero files, which keeps builds
// on non-macOS / without a built notch from failing.
const STAGE_ROOT = path.join(APP_ROOT, 'build', 'notch')
const STAGE_DEST = path.join(STAGE_ROOT, 'Jarvis Notch.app')

function candidateBundles(notchRoot) {
  return [
    path.join(notchRoot, '.build', 'xcode', 'Build', 'Products', 'Release', 'Jarvis Notch.app'),
    path.join(notchRoot, '.build', 'xcode', 'Build', 'Products', 'Debug', 'Jarvis Notch.app')
  ]
}

/** Pure: given candidate bundle paths, returns the first that looks like a real built app. */
function resolveBuiltBundleFrom(candidates, { existsSync = fs.existsSync } = {}) {
  return candidates.find(candidate => existsSync(path.join(candidate, 'Contents', 'MacOS', 'Jarvis Notch'))) || null
}

/**
 * Core staging logic, parametrized for tests. Always (re)creates `stageRoot`
 * (possibly empty); copies the resolved bundle into it when one exists and
 * the platform is darwin. Returns what happened, for tests/callers to assert
 * on instead of scraping console output.
 */
function stageNotch({
  platform = process.platform,
  notchRoot = NOTCH_ROOT,
  stageRoot = STAGE_ROOT,
  stageDest = STAGE_DEST,
  log = console.log,
  warn = console.warn,
  cpSync = fs.cpSync
} = {}) {
  fs.rmSync(stageRoot, { force: true, recursive: true })
  fs.mkdirSync(stageRoot, { recursive: true })

  if (platform !== 'darwin') {
    log('[stage-notch] not macOS — skipping (the notch companion is macOS-only)')
    return { reason: 'non-darwin', staged: false }
  }

  const bundle = resolveBuiltBundleFrom(candidateBundles(notchRoot))
  if (!bundle) {
    warn(
      '[stage-notch] Jarvis Notch.app not built — packaging without it. ' +
        'Run `apps/notch/scripts/build.sh build` (add `CONFIGURATION=Release` for a real release) first to include it.'
    )
    return { reason: 'not-built', staged: false }
  }

  cpSync(bundle, stageDest, { recursive: true, verbatimSymlinks: true })
  log(`[stage-notch] staged ${path.relative(REPO_ROOT, bundle)} -> ${path.relative(APP_ROOT, stageDest)}`)
  return { bundle, staged: true }
}

if (require.main === module) {
  stageNotch()
}

module.exports = { candidateBundles, resolveBuiltBundleFrom, stageNotch }
