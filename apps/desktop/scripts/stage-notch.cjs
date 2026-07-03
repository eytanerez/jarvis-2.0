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

const { execFileSync } = require('node:child_process')
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

// Build output / VCS dirs that must not count as "sources" for staleness.
const SOURCE_SKIP_DIRS = new Set(['.build', '.git', 'node_modules'])

/** Newest mtime (ms) of any file under `root`, skipping build output dirs. */
function newestSourceMtimeMs(root) {
  let newest = 0
  const stack = [root]

  while (stack.length) {
    const dir = stack.pop()
    let entries

    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }

    for (const entry of entries) {
      if (SOURCE_SKIP_DIRS.has(entry.name)) continue
      const full = path.join(dir, entry.name)

      if (entry.isDirectory()) {
        stack.push(full)
      } else if (entry.isFile()) {
        try {
          const mtime = fs.statSync(full).mtimeMs
          if (mtime > newest) newest = mtime
        } catch {
          // Deleted mid-scan — irrelevant for staleness.
        }
      }
    }
  }

  return newest
}

/**
 * Whether any notch source file is newer than the built binary. This is the
 * guard against the bug where fixes committed to apps/notch silently never
 * ship: the desktop `npm run build` (including the installed app's
 * self-update rebuild) reruns this script, but staging alone only copies
 * whatever stale bundle exists.
 */
function isBundleStale(bundle, notchRoot) {
  try {
    const binaryMtimeMs = fs.statSync(path.join(bundle, 'Contents', 'MacOS', 'Jarvis Notch')).mtimeMs
    return newestSourceMtimeMs(notchRoot) > binaryMtimeMs
  } catch {
    return false
  }
}

/** Default rebuild: the notch's own build script, Release configuration. */
function rebuildNotch(notchRoot) {
  execFileSync(path.join(notchRoot, 'scripts', 'build.sh'), ['build'], {
    env: { ...process.env, CONFIGURATION: 'Release' },
    stdio: 'inherit'
  })
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
  cpSync = fs.cpSync,
  rebuild = rebuildNotch
} = {}) {
  fs.rmSync(stageRoot, { force: true, recursive: true })
  fs.mkdirSync(stageRoot, { recursive: true })

  if (platform !== 'darwin') {
    log('[stage-notch] not macOS — skipping (the notch companion is macOS-only)')
    return { reason: 'non-darwin', staged: false }
  }

  let bundle = resolveBuiltBundleFrom(candidateBundles(notchRoot))
  if (!bundle) {
    warn(
      '[stage-notch] Jarvis Notch.app not built — packaging without it. ' +
        'Run `apps/notch/scripts/build.sh build` (add `CONFIGURATION=Release` for a real release) first to include it.'
    )
    return { reason: 'not-built', staged: false }
  }

  let rebuilt = false
  if (isBundleStale(bundle, notchRoot)) {
    log('[stage-notch] notch sources are newer than the built bundle — rebuilding (Release) so the fix actually ships…')
    try {
      rebuild(notchRoot)
      bundle = resolveBuiltBundleFrom(candidateBundles(notchRoot)) || bundle
      rebuilt = true
    } catch (error) {
      warn(
        `[stage-notch] notch rebuild failed (${error.message}) — staging the previously built (STALE) bundle. ` +
          'Run `npm run notch:build` manually and rebuild to ship current notch sources.'
      )
    }
  }

  cpSync(bundle, stageDest, { recursive: true, verbatimSymlinks: true })
  log(`[stage-notch] staged ${path.relative(REPO_ROOT, bundle)} -> ${path.relative(APP_ROOT, stageDest)}`)
  return { bundle, rebuilt, staged: true }
}

if (require.main === module) {
  stageNotch()
}

module.exports = { candidateBundles, isBundleStale, newestSourceMtimeMs, resolveBuiltBundleFrom, stageNotch }
