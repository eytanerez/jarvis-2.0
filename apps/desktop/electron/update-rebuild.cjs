'use strict'

/**
 * Retry-once policy for the desktop `--build-only` rebuild during self-update.
 *
 * The first rebuild can return nonzero on a still-settling post-update tree or a
 * network-blocked Electron fetch that the installer's self-heal repaired mid-run.
 * A second attempt then builds clean off the healed dist (the content-hash stamp
 * makes it a near-no-op when the first actually succeeded). Without the retry the
 * updater bails before the relaunch step — the app updates but doesn't restart.
 */

function shouldRetryRebuild(code) {
  return code !== 0
}

function normalizeUpdateSha(value) {
  const sha = typeof value === 'string' ? value.trim() : ''
  return /^[0-9a-f]{7,64}$/i.test(sha) ? sha : ''
}

function resolveClientUpdateBase({ installStamp, isPackaged = false, sourceSha } = {}) {
  const installedSha = normalizeUpdateSha(installStamp?.commit)
  const currentSourceSha = normalizeUpdateSha(sourceSha)
  const fromInstallStamp = Boolean(isPackaged && installedSha)

  return {
    currentSha: fromInstallStamp ? installedSha : currentSourceSha,
    fromInstallStamp,
    installedDirty: Boolean(installStamp?.dirty),
    installedSha: installedSha || null,
    sourceSha: currentSourceSha || null
  }
}

/**
 * Run `rebuild()` (async, resolves `{ code, ... }`), retrying once on failure.
 * Returns the final result.
 */
async function runRebuildWithRetry(rebuild) {
  let result = await rebuild(0)
  if (shouldRetryRebuild(result.code)) {
    result = await rebuild(1)
  }
  return result
}

module.exports = { normalizeUpdateSha, resolveClientUpdateBase, shouldRetryRebuild, runRebuildWithRetry }
