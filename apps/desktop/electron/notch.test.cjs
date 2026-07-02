/**
 * Tests for electron/notch.cjs — the loopback IPC hub for the native notch
 * companion app.
 *
 * Run with: node --test electron/notch.test.cjs
 *
 * Why this matters: the notch link is a localhost server holding a live door
 * into conversation state and conversation *control* (a client can start a
 * voice session). The token gate must actually reject unauthenticated
 * upgrades, late-joining clients must get a faithful snapshot (a notch that
 * reconnects mid-conversation has to render the right phase immediately), and
 * notch commands must round-trip to the host callback.
 *
 * Test-shape note: the server pushes its snapshot the instant a connection
 * opens, so message listeners MUST be attached before awaiting 'open' —
 * `once(ws, 'message')` after open loses frames that were emitted while no
 * listener existed. `connect()` therefore returns a message-queue reader
 * wired up at construction time.
 */

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { EventEmitter, once } = require('node:events')
const { test } = require('node:test')
const WebSocket = require('ws')

const { buildOrbUrl, createNotchLink, isAuthorized, resolveNotchAppPath, resolveNotchBuildScript, serveOrbStatic } = require('./notch.cjs')

// The real spawn would launch an actual Jarvis Notch.app on dev machines where
// the bundle exists — never do that from tests.
function fakeSpawn() {
  return { kill: () => {}, killed: false, once: () => {} }
}

function makeLink(overrides = {}) {
  return createNotchLink({
    devServerUrl: 'http://127.0.0.1:5174',
    // Never pkill real notch instances from tests.
    killStaleImpl: callback => callback(),
    log: () => {},
    spawnImpl: fakeSpawn,
    ...overrides
  })
}

async function connect(link, { token = link.token, viaHeader = false } = {}) {
  const url = viaHeader
    ? `ws://127.0.0.1:${link.port}/notch`
    : `ws://127.0.0.1:${link.port}/notch?token=${encodeURIComponent(token)}`
  const ws = new WebSocket(url, viaHeader ? { headers: { authorization: `Bearer ${token}` } } : undefined)

  const queue = []
  const waiters = []
  ws.on('message', data => {
    const message = JSON.parse(String(data))
    const waiter = waiters.shift()
    if (waiter) {
      waiter(message)
    } else {
      queue.push(message)
    }
  })

  const next = () => (queue.length > 0 ? Promise.resolve(queue.shift()) : new Promise(resolve => waiters.push(resolve)))

  await once(ws, 'open')

  // Snapshot = state, transcript, settings, and (when a dev server is
  // configured, as in every makeLink() here) the orb URL.
  const drainSnapshot = async () => {
    await next()
    await next()
    await next()
    await next()
  }

  return { drainSnapshot, next, ws }
}

test('isAuthorized accepts the token via header or query, rejects everything else', () => {
  const token = 'secret-token'

  assert.equal(isAuthorized({ headers: { authorization: `Bearer ${token}` }, url: '/notch' }, token), true)
  assert.equal(isAuthorized({ headers: {}, url: `/notch?token=${token}` }, token), true)
  assert.equal(isAuthorized({ headers: { authorization: 'Bearer nope' }, url: '/notch' }, token), false)
  assert.equal(isAuthorized({ headers: {}, url: '/notch?token=wrong' }, token), false)
  assert.equal(isAuthorized({ headers: {}, url: '/notch' }, token), false)
})

test('buildOrbUrl points at the dev server and carries port + token', () => {
  const url = buildOrbUrl({ devServerUrl: 'http://127.0.0.1:5174/', port: 4321, token: 'tok' })
  assert.equal(url, 'http://127.0.0.1:5174/notch-orb.html?port=4321&token=tok')

  // No dev server (packaged, Phase 4 pending): no orb URL — the notch shows
  // its native glow instead of a broken web view.
  assert.equal(buildOrbUrl({ devServerUrl: null, port: 4321, token: 'tok' }), null)
})

test('resolveNotchAppPath prefers the JARVIS_NOTCH_APP override when it is a real bundle', t => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'notch-test-'))
  t.after(() => fs.rmSync(tmp, { force: true, recursive: true }))

  const bundle = path.join(tmp, 'Jarvis Notch.app')
  fs.mkdirSync(path.join(bundle, 'Contents', 'MacOS'), { recursive: true })
  fs.writeFileSync(path.join(bundle, 'Contents', 'MacOS', 'Jarvis Notch'), '')

  assert.equal(
    resolveNotchAppPath({ env: { JARVIS_NOTCH_APP: bundle }, isPackaged: false, resourcesPath: null }),
    bundle
  )

  // A bogus override falls through to the other candidates instead of
  // returning a path that can't launch.
  const resolved = resolveNotchAppPath({
    env: { JARVIS_NOTCH_APP: path.join(tmp, 'missing.app') },
    isPackaged: false,
    resourcesPath: null
  })
  assert.notEqual(resolved, path.join(tmp, 'missing.app'))
})

test('unauthenticated upgrade is rejected, authenticated client gets the snapshot', async () => {
  const link = makeLink()
  await link.start()

  try {
    // Wrong token: the socket must never open.
    await assert.rejects(async () => {
      const ws = new WebSocket(`ws://127.0.0.1:${link.port}/notch?token=wrong`)
      await once(ws, 'open')
    })

    // Right token (query, like the browser orb page): snapshot replays state.
    const client = await connect(link)
    assert.deepEqual(await client.next(), { phase: 'idle', type: 'state' })
    client.ws.close()

    // Header auth (like the Swift client) works too.
    const headerClient = await connect(link, { viaHeader: true })
    assert.equal((await headerClient.next()).type, 'state')
    headerClient.ws.close()
  } finally {
    link.stop()
  }
})

test('published state is cached into the snapshot and broadcast live', async () => {
  const link = makeLink()
  await link.start()

  try {
    const early = await connect(link)
    await early.drainSnapshot()

    link.publish({ phase: 'listening', type: 'state' })
    assert.deepEqual(await early.next(), { phase: 'listening', type: 'state' })

    link.publish({ turns: [{ final: true, id: '1', role: 'user', text: 'hey jarvis' }], type: 'transcript' })
    await early.next() // transcript broadcast

    // A client that connects AFTER the updates still sees them (snapshot).
    const late = await connect(link)
    const snapshotState = await late.next()
    assert.equal(snapshotState.phase, 'listening')
    const snapshotTranscript = await late.next()
    assert.equal(snapshotTranscript.turns.length, 1)
    assert.equal(snapshotTranscript.turns[0].text, 'hey jarvis')

    early.ws.close()
    late.ws.close()
  } finally {
    link.stop()
  }
})

test('notch commands round-trip to the onCommand callback', async () => {
  const received = []
  const link = makeLink({ onCommand: message => received.push(message) })
  await link.start()

  try {
    const client = await connect(link)
    await client.drainSnapshot()

    client.ws.send(JSON.stringify({ type: 'startConversation' }))
    client.ws.send(JSON.stringify({ type: 'openMainWindow' }))
    // Unknown types and garbage must be ignored, not crash the link.
    client.ws.send(JSON.stringify({ type: 'formatDisk' }))
    client.ws.send('not json at all')

    await new Promise(resolve => setTimeout(resolve, 150))
    assert.deepEqual(
      received.map(message => message.type),
      ['startConversation', 'openMainWindow']
    )
    client.ws.close()
  } finally {
    link.stop()
  }
})

test('settings snapshots are cached and setting commands broadcast to connected clients', async () => {
  const snapshots = []
  const link = makeLink({ onSettings: snapshot => snapshots.push(snapshot) })
  await link.start()

  try {
    const client = await connect(link)
    await client.drainSnapshot()

    client.ws.send(
      JSON.stringify({
        snapshot: {
          connected: true,
          permissions: [{ id: 'accessibility', label: 'Accessibility', status: 'granted' }],
          values: { enableHaptics: true }
        },
        type: 'settingsSnapshot'
      })
    )

    await new Promise(resolve => setTimeout(resolve, 50))
    assert.equal(snapshots.at(-1).connected, true)
    assert.equal(snapshots.at(-1).values.enableHaptics, true)

    assert.equal(link.setSetting('enableHaptics', false), true)
    assert.deepEqual(await client.next(), { key: 'enableHaptics', type: 'settingsSet', value: false })

    const late = await connect(link)
    const received = [await late.next(), await late.next(), await late.next(), await late.next()]
    const settings = received.find(message => message.type === 'settingsSnapshot')
    assert.equal(settings.snapshot.values.enableHaptics, true)
    assert.equal(settings.snapshot.permissions[0].id, 'accessibility')

    client.ws.close()
    late.ws.close()
  } finally {
    link.stop()
  }
})

test('audio levels broadcast without being cached in the snapshot', async () => {
  const link = makeLink()
  await link.start()

  try {
    const client = await connect(link)
    await client.drainSnapshot()

    link.publish({ level: 0.42, type: 'audioLevel' })
    assert.deepEqual(await client.next(), { level: 0.42, type: 'audioLevel' })

    // Snapshot for a new client carries state/transcript/settings/orbUrl — no stale level.
    const late = await connect(link)
    const kinds = [(await late.next()).type, (await late.next()).type, (await late.next()).type, (await late.next()).type]
    assert.deepEqual(kinds.sort(), ['orbUrl', 'settingsSnapshot', 'state', 'transcript'])

    client.ws.close()
    late.ws.close()
  } finally {
    link.stop()
  }
})

test('tool activity broadcasts live and is cached for reconnecting clients', async () => {
  const link = makeLink()
  await link.start()

  try {
    const early = await connect(link)
    await early.drainSnapshot()

    const activity = { status: 'running', subtitle: 'Reading files', title: 'Running tool' }
    link.publish({ activity, type: 'toolActivity' })
    assert.deepEqual(await early.next(), { activity, type: 'toolActivity' })

    const late = await connect(link)
    const received = [await late.next(), await late.next(), await late.next(), await late.next(), await late.next()]
    const snapshotActivity = received.find(message => message.type === 'toolActivity')
    assert.deepEqual(snapshotActivity, { activity, type: 'toolActivity' })

    link.publish({ activity: null, type: 'toolActivity' })
    assert.deepEqual(await early.next(), { activity: null, type: 'toolActivity' })

    early.ws.close()
    late.ws.close()
  } finally {
    link.stop()
  }
})

test('startTimer publish forwards a one-shot native command without caching it', async () => {
  const link = makeLink()
  await link.start()

  try {
    const client = await connect(link)
    await client.drainSnapshot()

    link.publish({ durationSeconds: 30, label: 'Tea', type: 'startTimer' })
    assert.deepEqual(await client.next(), { durationSeconds: 30, label: 'Tea', type: 'startTimer' })

    const late = await connect(link)
    const kinds = [(await late.next()).type, (await late.next()).type, (await late.next()).type, (await late.next()).type]
    assert.deepEqual(kinds.sort(), ['orbUrl', 'settingsSnapshot', 'state', 'transcript'])

    client.ws.close()
    late.ws.close()
  } finally {
    link.stop()
  }
})

test('resolveNotchAppPath finds the bundle inside a source checkout (installed-app path)', t => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'notch-src-'))
  t.after(() => fs.rmSync(tmp, { force: true, recursive: true }))

  const bundle = path.join(tmp, 'apps', 'notch', '.build', 'xcode', 'Build', 'Products', 'Release', 'Jarvis Notch.app')
  fs.mkdirSync(path.join(bundle, 'Contents', 'MacOS'), { recursive: true })
  fs.writeFileSync(path.join(bundle, 'Contents', 'MacOS', 'Jarvis Notch'), '')

  assert.equal(
    resolveNotchAppPath({ env: {}, isPackaged: true, resourcesPath: path.join(tmp, 'nowhere'), sourceRoots: [tmp] }),
    bundle
  )
})

test('resolveNotchBuildScript finds the checkout build script', t => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'notch-script-'))
  t.after(() => fs.rmSync(tmp, { force: true, recursive: true }))

  assert.equal(resolveNotchBuildScript([tmp]), null)

  const script = path.join(tmp, 'apps', 'notch', 'scripts', 'build.sh')
  fs.mkdirSync(path.dirname(script), { recursive: true })
  fs.writeFileSync(script, '')
  assert.equal(resolveNotchBuildScript([null, tmp]), script)
})

test('buildOrbUrl falls back to link-served dist when no dev server runs', t => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'notch-dist-'))
  t.after(() => fs.rmSync(tmp, { force: true, recursive: true }))

  // dist without the orb page: still no URL.
  assert.equal(buildOrbUrl({ devServerUrl: null, port: 9, rendererDistDir: tmp, token: 't' }), null)

  fs.writeFileSync(path.join(tmp, 'notch-orb.html'), '<html></html>')
  assert.equal(
    buildOrbUrl({ devServerUrl: null, port: 9, rendererDistDir: tmp, token: 't' }),
    'http://127.0.0.1:9/notch-orb.html?port=9&token=t'
  )

  // Dev server still wins when present.
  assert.equal(
    buildOrbUrl({ devServerUrl: 'http://127.0.0.1:5174', port: 9, rendererDistDir: tmp, token: 't' }),
    'http://127.0.0.1:5174/notch-orb.html?port=9&token=t'
  )
})

test('serveOrbStatic serves dist files and refuses escapes', t => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'notch-static-'))
  t.after(() => fs.rmSync(tmp, { force: true, recursive: true }))

  fs.writeFileSync(path.join(tmp, 'notch-orb.html'), '<html>orb</html>')
  fs.mkdirSync(path.join(tmp, 'assets'))
  fs.writeFileSync(path.join(tmp, 'assets', 'app.js'), 'js')
  fs.writeFileSync(path.join(os.tmpdir(), 'notch-static-outside.js'), 'nope')

  function fakeRes() {
    const res = {
      body: null,
      end(content) {
        res.body = content
      },
      headers: {},
      setHeader(name, value) {
        res.headers[name] = value
      },
      statusCode: 0
    }
    return res
  }

  const html = fakeRes()
  assert.equal(serveOrbStatic({ method: 'GET', url: '/notch-orb.html?token=x' }, html, tmp), true)
  assert.equal(html.statusCode, 200)
  assert.equal(String(html.body), '<html>orb</html>')
  assert.match(html.headers['content-type'], /text\/html/)

  const js = fakeRes()
  assert.equal(serveOrbStatic({ method: 'GET', url: '/assets/app.js' }, js, tmp), true)
  assert.equal(String(js.body), 'js')

  // Traversal, non-GET, unknown extensions, and no-dist all fall through.
  assert.equal(serveOrbStatic({ method: 'GET', url: '/../notch-static-outside.js' }, fakeRes(), tmp), false)
  assert.equal(serveOrbStatic({ method: 'GET', url: '/..%2fnotch-static-outside.js' }, fakeRes(), tmp), false)
  assert.equal(serveOrbStatic({ method: 'POST', url: '/notch-orb.html' }, fakeRes(), tmp), false)
  assert.equal(serveOrbStatic({ method: 'GET', url: '/notch' }, fakeRes(), tmp), false)
  assert.equal(serveOrbStatic({ method: 'GET', url: '/notch-orb.html' }, fakeRes(), null), false)
})

/**
 * A fake spawned child that actually behaves like one (kill() fires 'exit'),
 * unlike the static `fakeSpawn()` used elsewhere — needed to exercise the
 * restart/relaunch branches, which key off exit code + a restart flag.
 */
function makeControllableChild() {
  const emitter = new EventEmitter()
  emitter.killed = false
  emitter.kill = signal => {
    if (emitter.killed) return
    emitter.killed = true
    // Real child_process 'exit' gets (code, signal); SIGTERM → code null.
    setImmediate(() => emitter.emit('exit', signal ? null : 0, signal || null))
  }
  return emitter
}

test('restartNotch kills the running child and respawns immediately, bypassing backoff', async () => {
  const children = []
  // Termination goes through killStaleImpl now (spawnNotchApp launches via
  // `open`, so `child` is that wrapper, not the real app — killing it
  // directly wouldn't kill the app; see killNotchProcess in notch.cjs).
  // This fake reproduces the real causal chain: an external kill-by-name
  // kills the actual app, which makes `open -W`'s wrapper (the fake child
  // here) notice and exit — so killing the CURRENT child simulates it.
  const killStaleImpl = callback => {
    const current = children.at(-1)
    if (current && !current.killed) {
      current.kill('SIGTERM')
    }
    callback()
  }

  // No real bundle exists in the test env, so spawnImpl is only reached via
  // resolveNotchAppPath finding a fake one — stub that too.
  const fakeBundle = fs.mkdtempSync(path.join(os.tmpdir(), 'notch-restart-'))
  const bundlePath = path.join(fakeBundle, 'Jarvis Notch.app', 'Contents', 'MacOS')
  fs.mkdirSync(bundlePath, { recursive: true })
  fs.writeFileSync(path.join(bundlePath, 'Jarvis Notch'), '')

  const realLink = createNotchLink({
    devServerUrl: 'http://127.0.0.1:5174',
    env: { JARVIS_NOTCH_APP: path.join(fakeBundle, 'Jarvis Notch.app') },
    killStaleImpl,
    log: () => {},
    spawnImpl: () => {
      const child = makeControllableChild()
      children.push(child)
      return child
    }
  })

  try {
    await realLink.start()
    assert.equal(children.length, 1, 'spawned once on start')
    const firstChild = children[0]

    realLink.restartNotch()
    assert.equal(firstChild.killed, true)

    // Wait for the fake 'exit' (setImmediate) and the synchronous respawn it
    // triggers to land.
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(children.length, 2, 'respawned once after restart, no backoff delay')
  } finally {
    realLink.stop()
    fs.rmSync(fakeBundle, { force: true, recursive: true })
  }
})

test('restartNotch spawns immediately when nothing is currently running', async () => {
  const children = []
  const fakeBundle = fs.mkdtempSync(path.join(os.tmpdir(), 'notch-restart-idle-'))
  const bundlePath = path.join(fakeBundle, 'Jarvis Notch.app', 'Contents', 'MacOS')
  fs.mkdirSync(bundlePath, { recursive: true })
  fs.writeFileSync(path.join(bundlePath, 'Jarvis Notch'), '')

  const link = createNotchLink({
    devServerUrl: 'http://127.0.0.1:5174',
    env: { JARVIS_NOTCH_APP: path.join(fakeBundle, 'Jarvis Notch.app') },
    killStaleImpl: callback => callback(),
    log: () => {},
    spawnImpl: () => {
      const child = makeControllableChild()
      children.push(child)
      return child
    }
  })

  try {
    await link.start()
    assert.equal(children.length, 1)

    // Simulate a real crash (no restart requested) that's currently mid-backoff...
    children[0].kill('SIGKILL')
    await new Promise(resolve => setImmediate(resolve))

    // ...then an explicit restart should short-circuit that backoff and spawn now.
    link.restartNotch()
    assert.equal(children.length, 2)
  } finally {
    link.stop()
    fs.rmSync(fakeBundle, { force: true, recursive: true })
  }
})

test('gives up relaunching after MAX_RELAUNCH_ATTEMPTS consecutive unexpected exits', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })

  const children = []
  const fakeBundle = fs.mkdtempSync(path.join(os.tmpdir(), 'notch-crashloop-'))
  const bundlePath = path.join(fakeBundle, 'Jarvis Notch.app', 'Contents', 'MacOS')
  fs.mkdirSync(bundlePath, { recursive: true })
  fs.writeFileSync(path.join(bundlePath, 'Jarvis Notch'), '')

  const link = createNotchLink({
    devServerUrl: 'http://127.0.0.1:5174',
    env: { JARVIS_NOTCH_APP: path.join(fakeBundle, 'Jarvis Notch.app') },
    killStaleImpl: callback => callback(),
    log: () => {},
    spawnImpl: () => {
      const child = makeControllableChild()
      children.push(child)
      return child
    }
  })

  try {
    await link.start()
    assert.equal(children.length, 1)

    // Crash every child immediately and fast-forward through the backoff
    // delay after each one, simulating a binary that can never survive.
    // makeControllableChild's kill() emits 'exit' via a REAL setImmediate
    // (only setTimeout is mocked above), so that needs an actual event-loop
    // turn — mock.timers.tick() only advances fake time, it doesn't pump
    // real macrotasks.
    for (let i = 0; i < 8; i++) {
      const current = children.at(-1)
      current.kill('SIGKILL')
      await new Promise(resolve => setImmediate(resolve)) // let the real 'exit' land
      t.mock.timers.tick(30_000) // clear even the maxed-out backoff delay
    }

    // Capped at MAX_RELAUNCH_ATTEMPTS relaunches beyond the first spawn —
    // it must have stopped scheduling more, not kept going for all 8 crashes.
    assert.equal(children.length, 7, '1 initial spawn + 6 relaunches, then it gives up')
  } finally {
    link.stop()
    fs.rmSync(fakeBundle, { force: true, recursive: true })
  }
})

test('spawnNotchApp launches via open -n -W (not a direct binary exec), carrying port and token', async () => {
  const fakeBundle = fs.mkdtempSync(path.join(os.tmpdir(), 'notch-openlaunch-'))
  const bundlePath = path.join(fakeBundle, 'Jarvis Notch.app', 'Contents', 'MacOS')
  fs.mkdirSync(bundlePath, { recursive: true })
  fs.writeFileSync(path.join(bundlePath, 'Jarvis Notch'), '')
  const appPath = path.join(fakeBundle, 'Jarvis Notch.app')

  let capturedCommand = null
  let capturedArgs = null
  const link = createNotchLink({
    devServerUrl: 'http://127.0.0.1:5174',
    env: { JARVIS_NOTCH_APP: appPath },
    killStaleImpl: callback => callback(),
    log: () => {},
    spawnImpl: (command, args) => {
      capturedCommand = command
      capturedArgs = args
      return makeControllableChild()
    }
  })

  try {
    await link.start()

    // Direct exec of the binary inside the bundle is exactly what causes the
    // TCC bundle-misattribution SIGABRT this launch method exists to avoid
    // (see spawnNotchApp's comment) — assert the fix, not just "it launches".
    assert.equal(capturedCommand, 'open')
    assert.notEqual(capturedCommand, path.join(appPath, 'Contents', 'MacOS', 'Jarvis Notch'))
    assert.equal(capturedArgs[0], '-n')
    assert.equal(capturedArgs[1], '-W')
    assert.equal(capturedArgs[2], '-a')
    assert.equal(capturedArgs[3], appPath)
    assert.equal(capturedArgs[4], '--args')
    assert.equal(capturedArgs[5], '--jarvis-port')
    assert.equal(capturedArgs[6], String(link.port))
    assert.equal(capturedArgs[7], '--jarvis-token')
    assert.equal(capturedArgs[8], link.token)
  } finally {
    link.stop()
    fs.rmSync(fakeBundle, { force: true, recursive: true })
  }
})

test('a userQuit signal suppresses relaunch, unlike an unsignaled exit which is treated as a crash', async () => {
  const fakeBundle = fs.mkdtempSync(path.join(os.tmpdir(), 'notch-userquit-'))
  const bundlePath = path.join(fakeBundle, 'Jarvis Notch.app', 'Contents', 'MacOS')
  fs.mkdirSync(bundlePath, { recursive: true })
  fs.writeFileSync(path.join(bundlePath, 'Jarvis Notch'), '')

  const children = []
  const link = createNotchLink({
    devServerUrl: 'http://127.0.0.1:5174',
    env: { JARVIS_NOTCH_APP: path.join(fakeBundle, 'Jarvis Notch.app') },
    killStaleImpl: callback => callback(),
    log: () => {},
    spawnImpl: () => {
      const child = makeControllableChild()
      children.push(child)
      return child
    }
  })

  try {
    await link.start()
    assert.equal(children.length, 1)

    // `open`'s own exit code is always ~0 regardless of how the launched app
    // actually exited (verified manually — see notch.cjs's spawnNotchApp
    // comment), so relaunch-suppression can't key off it. It must key off
    // the explicit userQuit message instead — send that over the WS link,
    // exactly like the real notch's Quit button does before terminating.
    const client = await connect(link)
    await client.drainSnapshot()
    client.ws.send(JSON.stringify({ type: 'userQuit' }))
    await new Promise(resolve => setTimeout(resolve, 50))

    children[0].kill('SIGTERM') // open's wrapper "exiting" once the real app quits
    await new Promise(resolve => setImmediate(resolve))

    assert.equal(children.length, 1, 'signaled quit is not relaunched')
    client.ws.close()
  } finally {
    link.stop()
    fs.rmSync(fakeBundle, { force: true, recursive: true })
  }
})

test('an exit with no userQuit signal is treated as a crash and relaunched', async () => {
  const fakeBundle = fs.mkdtempSync(path.join(os.tmpdir(), 'notch-crashquit-'))
  const bundlePath = path.join(fakeBundle, 'Jarvis Notch.app', 'Contents', 'MacOS')
  fs.mkdirSync(bundlePath, { recursive: true })
  fs.writeFileSync(path.join(bundlePath, 'Jarvis Notch'), '')

  const children = []
  const link = createNotchLink({
    devServerUrl: 'http://127.0.0.1:5174',
    env: { JARVIS_NOTCH_APP: path.join(fakeBundle, 'Jarvis Notch.app') },
    killStaleImpl: callback => callback(),
    log: () => {},
    spawnImpl: () => {
      const child = makeControllableChild()
      children.push(child)
      return child
    }
  })

  try {
    await link.start()
    assert.equal(children.length, 1)

    // No userQuit message this time — an unsignaled exit is a crash.
    children[0].kill('SIGABRT')
    await new Promise(resolve => setImmediate(resolve))
    await new Promise(resolve => setTimeout(resolve, 1100)) // first backoff delay (1s)

    assert.equal(children.length, 2, 'unsignaled exit is relaunched')
  } finally {
    link.stop()
    fs.rmSync(fakeBundle, { force: true, recursive: true })
  }
})
