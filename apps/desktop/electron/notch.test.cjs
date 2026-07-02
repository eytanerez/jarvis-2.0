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
const { once } = require('node:events')
const { test } = require('node:test')
const WebSocket = require('ws')

const { buildOrbUrl, createNotchLink, isAuthorized, resolveNotchAppPath } = require('./notch.cjs')

// The real spawn would launch an actual Jarvis Notch.app on dev machines where
// the bundle exists — never do that from tests.
function fakeSpawn() {
  return { kill: () => {}, killed: false, once: () => {} }
}

function makeLink(overrides = {}) {
  return createNotchLink({
    devServerUrl: 'http://127.0.0.1:5174',
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
