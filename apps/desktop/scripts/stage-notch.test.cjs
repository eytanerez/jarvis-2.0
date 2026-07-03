const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const { candidateBundles, resolveBuiltBundleFrom, stageNotch } = require('./stage-notch.cjs')

function makeFakeBundle(root, configuration) {
  const bundlePath = path.join(root, '.build', 'xcode', 'Build', 'Products', configuration, 'Jarvis Notch.app')
  fs.mkdirSync(path.join(bundlePath, 'Contents', 'MacOS'), { recursive: true })
  fs.writeFileSync(path.join(bundlePath, 'Contents', 'MacOS', 'Jarvis Notch'), '')
  return bundlePath
}

test('candidateBundles prefers Release before Debug', () => {
  const candidates = candidateBundles('/repo/apps/notch')
  assert.equal(candidates.length, 2)
  assert.match(candidates[0], /Release/)
  assert.match(candidates[1], /Debug/)
})

test('resolveBuiltBundleFrom picks the first candidate that actually exists', () => {
  // resolveBuiltBundleFrom checks <candidate>/Contents/MacOS/Jarvis Notch;
  // strip those three segments back off to compare against the bundle path.
  const existing = new Set(['/repo/Debug/Jarvis Notch.app'])
  const resolved = resolveBuiltBundleFrom(['/repo/Release/Jarvis Notch.app', '/repo/Debug/Jarvis Notch.app'], {
    existsSync: p => existing.has(path.dirname(path.dirname(path.dirname(p))))
  })
  assert.equal(resolved, '/repo/Debug/Jarvis Notch.app')
})

test('resolveBuiltBundleFrom returns null when nothing exists', () => {
  const resolved = resolveBuiltBundleFrom(['/repo/Release/Jarvis Notch.app'], { existsSync: () => false })
  assert.equal(resolved, null)
})

test('stageNotch on non-macOS creates an empty stage dir and does not copy', t => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'stage-notch-'))
  t.after(() => fs.rmSync(tempRoot, { force: true, recursive: true }))

  const stageRoot = path.join(tempRoot, 'build', 'notch')
  const notchRoot = path.join(tempRoot, 'apps', 'notch')
  makeFakeBundle(notchRoot, 'Release')

  const logs = []
  const result = stageNotch({
    log: msg => logs.push(msg),
    notchRoot,
    platform: 'linux',
    stageDest: path.join(stageRoot, 'Jarvis Notch.app'),
    stageRoot,
    warn: () => assert.fail('should not warn on a clean non-macOS skip')
  })

  assert.deepEqual(result, { reason: 'non-darwin', staged: false })
  assert.equal(fs.existsSync(stageRoot), true, 'stage dir exists (extraResources "from" must resolve)')
  assert.deepEqual(fs.readdirSync(stageRoot), [], 'nothing copied on non-macOS')
  assert.equal(logs.some(l => l.includes('not macOS')), true)
})

test('stageNotch on macOS with no built bundle warns and leaves the stage dir empty', t => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'stage-notch-'))
  t.after(() => fs.rmSync(tempRoot, { force: true, recursive: true }))

  const stageRoot = path.join(tempRoot, 'build', 'notch')
  const notchRoot = path.join(tempRoot, 'apps', 'notch') // nothing built here

  const warnings = []
  const result = stageNotch({
    notchRoot,
    platform: 'darwin',
    stageDest: path.join(stageRoot, 'Jarvis Notch.app'),
    stageRoot,
    warn: msg => warnings.push(msg)
  })

  assert.deepEqual(result, { reason: 'not-built', staged: false })
  assert.equal(fs.existsSync(stageRoot), true)
  assert.deepEqual(fs.readdirSync(stageRoot), [])
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /apps\/notch\/scripts\/build\.sh/)
})

test('stageNotch on macOS with a built bundle copies it into the stage dir, preferring Release', t => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'stage-notch-'))
  t.after(() => fs.rmSync(tempRoot, { force: true, recursive: true }))

  const stageRoot = path.join(tempRoot, 'build', 'notch')
  const stageDest = path.join(stageRoot, 'Jarvis Notch.app')
  const notchRoot = path.join(tempRoot, 'apps', 'notch')
  makeFakeBundle(notchRoot, 'Debug')
  const releaseBundle = makeFakeBundle(notchRoot, 'Release')

  const result = stageNotch({ notchRoot, platform: 'darwin', stageDest, stageRoot })

  assert.equal(result.staged, true)
  assert.equal(result.bundle, releaseBundle)
  assert.equal(fs.existsSync(path.join(stageDest, 'Contents', 'MacOS', 'Jarvis Notch')), true)
})

test('stageNotch rebuilds when a source file is newer than the built binary', t => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'stage-notch-'))
  t.after(() => fs.rmSync(tempRoot, { force: true, recursive: true }))

  const stageRoot = path.join(tempRoot, 'build', 'notch')
  const stageDest = path.join(stageRoot, 'Jarvis Notch.app')
  const notchRoot = path.join(tempRoot, 'apps', 'notch')
  const bundle = makeFakeBundle(notchRoot, 'Release')

  // Binary built "an hour ago"; a Swift source touched now.
  const binary = path.join(bundle, 'Contents', 'MacOS', 'Jarvis Notch')
  const past = new Date(Date.now() - 60 * 60 * 1000)
  fs.utimesSync(binary, past, past)
  fs.mkdirSync(path.join(notchRoot, 'DynamicIsland'), { recursive: true })
  fs.writeFileSync(path.join(notchRoot, 'DynamicIsland', 'Fresh.swift'), 'struct Fresh {}')

  const rebuilds = []
  const result = stageNotch({
    notchRoot,
    platform: 'darwin',
    rebuild: root => {
      rebuilds.push(root)
      // Simulate the rebuild refreshing the binary.
      fs.writeFileSync(binary, 'rebuilt')
    },
    stageDest,
    stageRoot
  })

  assert.deepEqual(rebuilds, [notchRoot])
  assert.equal(result.staged, true)
  assert.equal(result.rebuilt, true)
  assert.equal(fs.readFileSync(path.join(stageDest, 'Contents', 'MacOS', 'Jarvis Notch'), 'utf8'), 'rebuilt')
})

test('stageNotch does not rebuild when the binary is newer than every source', t => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'stage-notch-'))
  t.after(() => fs.rmSync(tempRoot, { force: true, recursive: true }))

  const stageRoot = path.join(tempRoot, 'build', 'notch')
  const notchRoot = path.join(tempRoot, 'apps', 'notch')
  const bundle = makeFakeBundle(notchRoot, 'Release')

  // Source older than the binary.
  const past = new Date(Date.now() - 60 * 60 * 1000)
  fs.mkdirSync(path.join(notchRoot, 'DynamicIsland'), { recursive: true })
  const source = path.join(notchRoot, 'DynamicIsland', 'Old.swift')
  fs.writeFileSync(source, 'struct Old {}')
  fs.utimesSync(source, past, past)
  fs.writeFileSync(path.join(bundle, 'Contents', 'MacOS', 'Jarvis Notch'), 'current')

  const result = stageNotch({
    notchRoot,
    platform: 'darwin',
    rebuild: () => assert.fail('must not rebuild a fresh bundle'),
    stageDest: path.join(stageRoot, 'Jarvis Notch.app'),
    stageRoot
  })

  assert.equal(result.staged, true)
  assert.equal(result.rebuilt, false)
})

test('stageNotch stages the stale bundle with a warning when the rebuild fails', t => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'stage-notch-'))
  t.after(() => fs.rmSync(tempRoot, { force: true, recursive: true }))

  const stageRoot = path.join(tempRoot, 'build', 'notch')
  const stageDest = path.join(stageRoot, 'Jarvis Notch.app')
  const notchRoot = path.join(tempRoot, 'apps', 'notch')
  const bundle = makeFakeBundle(notchRoot, 'Release')

  const past = new Date(Date.now() - 60 * 60 * 1000)
  const binary = path.join(bundle, 'Contents', 'MacOS', 'Jarvis Notch')
  fs.utimesSync(binary, past, past)
  fs.mkdirSync(path.join(notchRoot, 'DynamicIsland'), { recursive: true })
  fs.writeFileSync(path.join(notchRoot, 'DynamicIsland', 'Fresh.swift'), 'struct Fresh {}')

  const warnings = []
  const result = stageNotch({
    notchRoot,
    platform: 'darwin',
    rebuild: () => {
      throw new Error('xcodebuild exploded')
    },
    stageDest,
    stageRoot,
    warn: msg => warnings.push(msg)
  })

  assert.equal(result.staged, true)
  assert.equal(result.rebuilt, false)
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /STALE/)
  assert.equal(fs.existsSync(path.join(stageDest, 'Contents', 'MacOS', 'Jarvis Notch')), true)
})

test('stageNotch clears a stale prior stage before restaging', t => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'stage-notch-'))
  t.after(() => fs.rmSync(tempRoot, { force: true, recursive: true }))

  const stageRoot = path.join(tempRoot, 'build', 'notch')
  const stageDest = path.join(stageRoot, 'Jarvis Notch.app')
  fs.mkdirSync(stageRoot, { recursive: true })
  fs.writeFileSync(path.join(stageRoot, 'stale-leftover.txt'), 'x')

  const notchRoot = path.join(tempRoot, 'apps', 'notch')

  stageNotch({ notchRoot, platform: 'darwin', stageDest, stageRoot })

  assert.equal(fs.existsSync(path.join(stageRoot, 'stale-leftover.txt')), false)
})
