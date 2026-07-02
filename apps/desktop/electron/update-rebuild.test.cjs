/**
 * Tests for electron/update-rebuild.cjs — the retry-once policy for the desktop
 * `--build-only` rebuild during self-update.
 *
 * Run with: node --test electron/update-rebuild.test.cjs
 * (Wired into npm test:desktop:platforms in package.json.)
 *
 * Why this matters: a first rebuild can return nonzero on a still-settling tree
 * or a self-healed (network-blocked) Electron download. Without a second attempt
 * the updater bails before the relaunch step — the app updates but never restarts
 * (the field report behind this fix). The retry must fire on failure, not on
 * success, and must run at most twice.
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const {
  normalizeUpdateSha,
  resolveClientUpdateBase,
  shouldRetryRebuild,
  runRebuildWithRetry
} = require('./update-rebuild.cjs')

test('shouldRetryRebuild retries only on a non-success exit', () => {
  assert.equal(shouldRetryRebuild(0), false)
  assert.equal(shouldRetryRebuild(1), true)
  assert.equal(shouldRetryRebuild(null), true)
})

test('normalizeUpdateSha accepts git-looking shas and rejects unsafe refs', () => {
  assert.equal(normalizeUpdateSha('  45314dbba883cfd7df0e5692a6c1d712b34bf54a\n'), '45314dbba883cfd7df0e5692a6c1d712b34bf54a')
  assert.equal(normalizeUpdateSha('78a48e8'), '78a48e8')
  assert.equal(normalizeUpdateSha('main'), '')
  assert.equal(normalizeUpdateSha('HEAD..origin/main'), '')
  assert.equal(normalizeUpdateSha(null), '')
})

test('packaged client update checks use the running app install stamp as current sha', () => {
  const base = resolveClientUpdateBase({
    installStamp: { commit: '78a48e8a009ad410fc58a19b81666a8308a5a93d', dirty: true },
    isPackaged: true,
    sourceSha: '45314dbba883cfd7df0e5692a6c1d712b34bf54a'
  })

  assert.equal(base.currentSha, '78a48e8a009ad410fc58a19b81666a8308a5a93d')
  assert.equal(base.fromInstallStamp, true)
  assert.equal(base.installedDirty, true)
  assert.equal(base.sourceSha, '45314dbba883cfd7df0e5692a6c1d712b34bf54a')
})

test('dev client update checks fall back to the source checkout sha', () => {
  const base = resolveClientUpdateBase({
    installStamp: { commit: '78a48e8a009ad410fc58a19b81666a8308a5a93d' },
    isPackaged: false,
    sourceSha: '45314dbba883cfd7df0e5692a6c1d712b34bf54a'
  })

  assert.equal(base.currentSha, '45314dbba883cfd7df0e5692a6c1d712b34bf54a')
  assert.equal(base.fromInstallStamp, false)
})

test('a clean first rebuild runs once and does not retry', async () => {
  const codes = []
  const result = await runRebuildWithRetry(attempt => {
    codes.push(attempt)
    return Promise.resolve({ code: 0 })
  })
  assert.deepEqual(codes, [0])
  assert.equal(result.code, 0)
})

test('a failed first rebuild retries once and succeeds', async () => {
  const codes = []
  const result = await runRebuildWithRetry(attempt => {
    codes.push(attempt)
    return Promise.resolve({ code: attempt === 0 ? 1 : 0 })
  })
  assert.deepEqual(codes, [0, 1])
  assert.equal(result.code, 0)
})

test('a rebuild that keeps failing runs at most twice and reports the failure', async () => {
  const codes = []
  const result = await runRebuildWithRetry(attempt => {
    codes.push(attempt)
    return Promise.resolve({ code: 1, error: 'rebuild-failed' })
  })
  assert.deepEqual(codes, [0, 1])
  assert.equal(result.code, 1)
  assert.equal(result.error, 'rebuild-failed')
})
