/**
 * Jarvis Mobile bridge — the desktop side of the linked-iPhone system.
 *
 * The Mac stays the only host that runs Jarvis; a paired phone is a remote
 * surface. This module (a sibling of notch.cjs, same factory/DI idioms):
 *
 *   - Runs a LAN WebSocket server (`/link`, default port 8776) phones use at
 *     home, and dials OUT to the Cloudflare relay (relay/ in the Jarvis 3.0
 *     App repo) so the same phone works from anywhere. Both paths carry the
 *     identical AES-256-GCM envelope protocol (mobile-link-crypto.cjs) — the
 *     relay and the home Wi-Fi see ciphertext only.
 *   - Owns pairing: one-shot QR payloads (5 min TTL) mint per-device link
 *     keys + revocable device tokens persisted via mobile-link-store.cjs.
 *   - Proxies authenticated devices to the loopback Python dashboard: JSON-RPC
 *     frames to /api/ws (through a per-device upstream socket, so the gateway
 *     treats each phone as a first-class client) and a small HTTP allowlist
 *     (audio transcribe/speak, sessions, model get/set, status). Everything
 *     else — shell.exec, env, config — is refused here, before it ever
 *     reaches the brain.
 *
 * Protocol reference: `plans/jarvis-mobile-spec.md` in the Jarvis 3.0 App repo.
 */

const http = require('node:http')
const os = require('node:os')
const path = require('node:path')

const {
  b64url,
  buildPairingUrl,
  generateId,
  generateLinkKey,
  openEnvelope,
  peekEnvelope,
  sealEnvelope
} = require('./mobile-link-crypto.cjs')
const { createMobileLinkStore, defaultJarvisHome } = require('./mobile-link-store.cjs')

const LAN_PORT_DEFAULT = 8776
const LAN_PORT_ATTEMPTS = 10
const PAIRING_TTL_MS = 5 * 60_000
const HANDSHAKE_TIMEOUT_MS = 15_000
const GARBAGE_FRAME_LIMIT = 5
const RELAY_BACKOFF_BASE_MS = 1_000
const RELAY_BACKOFF_MAX_MS = 30_000
const UPSTREAM_BACKOFF_BASE_MS = 1_000
const UPSTREAM_BACKOFF_MAX_MS = 15_000
const LAN_HINT_POLL_MS = 60_000
const MAX_HTTP_BODY_BYTES = 16 * 1024 * 1024

/**
 * JSON-RPC methods a phone may invoke. Deliberately excludes anything that
 * executes arbitrary code or edits configuration (shell.exec, cli.exec,
 * config.set, reload.env, …) — the phone approves commands, it doesn't run
 * them.
 */
const RPC_ALLOWED_METHODS = new Set([
  'approval.respond',
  'clarify.respond',
  'image.attach_bytes',
  'image.detach',
  'model.options',
  'pdf.attach',
  'prompt.submit',
  'session.active_list',
  'session.create',
  'session.history',
  'session.interrupt',
  'session.list',
  'session.most_recent',
  'session.resume',
  'session.status',
  'session.title'
])

/** Dashboard HTTP endpoints a phone may call, proxied with the real token. */
const HTTP_ALLOWED = new Set([
  'GET /api/model/info',
  'GET /api/model/options',
  'GET /api/sessions',
  'GET /api/status',
  'POST /api/audio/speak',
  'POST /api/audio/transcribe',
  'POST /api/audio/warmup',
  'POST /api/model/set'
])

// Parameterized session endpoints: transcripts (read), rename/archive
// (PATCH), and delete. Still no code-execution surface.
const HTTP_ALLOWED_PATTERNS = [
  /^GET \/api\/sessions\/[^/]+\/messages$/,
  /^PATCH \/api\/sessions\/[^/]+$/,
  /^DELETE \/api\/sessions\/[^/]+$/
]

function isHttpAllowed(key) {
  return HTTP_ALLOWED.has(key) || HTTP_ALLOWED_PATTERNS.some(pattern => pattern.test(key))
}

/** Phone RPCs that mutate the shared session list — the desktop renderer
 * re-pulls its sidebar when one goes through. */
const SESSION_MUTATING_RPC_METHODS = new Set(['prompt.submit', 'session.create', 'session.title'])

/** Same hoisting-gotcha fallback as notch.cjs (ws staged under resources). */
function requireWs() {
  try {
    return require('ws')
  } catch (firstError) {
    const resourcesPath = process.resourcesPath
    if (!resourcesPath) throw firstError
    return require(path.join(resourcesPath, 'native-deps', 'ws'))
  }
}

function defaultHostName() {
  const raw = os.hostname() || 'Mac'
  return raw.replace(/\.local\.?$/i, '').replaceAll('-', ' ')
}

/** All the ways a phone on the same network can reach the LAN server. */
function collectLanUrls(port) {
  if (!port) return []

  const urls = []
  const hostname = os.hostname()

  // The mDNS name first: it survives DHCP reassignments.
  if (hostname) {
    const bonjourHost = hostname.endsWith('.local') ? hostname : `${hostname}.local`
    urls.push(`ws://${bonjourHost}:${port}/link`)
  }

  for (const entries of Object.values(os.networkInterfaces() || {})) {
    for (const entry of entries || []) {
      if (entry.family === 'IPv4' && !entry.internal) {
        urls.push(`ws://${entry.address}:${port}/link`)
      }
    }
  }

  return [...new Set(urls)]
}

function relayHostEndpoint(relayUrl, hostId) {
  let base = String(relayUrl || '').trim().replace(/\/+$/, '')

  if (!base) return null
  if (base.startsWith('https://')) base = `wss://${base.slice('https://'.length)}`
  else if (base.startsWith('http://')) base = `ws://${base.slice('http://'.length)}`
  else if (!base.startsWith('ws://') && !base.startsWith('wss://')) base = `wss://${base}`

  return `${base}/host/${hostId}`
}

function createMobileBridge({
  WebSocketImpl = null,
  WebSocketServerImpl = null,
  fetchImpl = null,
  getDashboard = async () => null,
  hostName = defaultHostName(),
  jarvisHome = defaultJarvisHome(),
  lanPortPreference = LAN_PORT_DEFAULT,
  log = () => {},
  now = Date.now,
  onActivity = () => {},
  onDevicesChanged = () => {},
  onStatusChanged = () => {}
} = {}) {
  const store = createMobileLinkStore({ dir: jarvisHome, log })

  let identity = null
  let started = false
  let enabled = false
  let lanServer = null
  let lanWss = null
  let lanPort = null
  let lanHintTimer = null
  let lastLanUrlsJson = null

  let relaySocket = null
  let relayConnected = false
  let relayTimer = null
  let relayAttempt = 0
  let relayGeneration = 0

  const sessions = new Set()
  const pairings = new Map()

  function wsModule() {
    if (WebSocketImpl && WebSocketServerImpl) {
      return { WebSocket: WebSocketImpl, WebSocketServer: WebSocketServerImpl }
    }

    const real = requireWs()

    return {
      WebSocket: WebSocketImpl || real.WebSocket,
      WebSocketServer: WebSocketServerImpl || real.WebSocketServer
    }
  }

  function doFetch(...args) {
    return (fetchImpl || globalThis.fetch)(...args)
  }

  function emitStatus() {
    try {
      onStatusChanged(getState())
    } catch {
      // Listener errors must never take the bridge down.
    }
  }

  function emitDevices() {
    try {
      onDevicesChanged(publicDevices())
    } catch {
      // Same.
    }
  }

  /** Phone did something that changes the shared session list. */
  function emitActivity() {
    try {
      onActivity()
    } catch {
      // Same.
    }
  }

  function publicDevices() {
    return store.listDevices().map(device => ({
      connected: [...sessions].some(session => session.authed && session.deviceId === device.id),
      createdAt: device.createdAt,
      id: device.id,
      lastSeenAt: device.lastSeenAt,
      model: device.model,
      name: device.name,
      revoked: Boolean(device.revokedAt)
    }))
  }

  // ── Session plumbing ─────────────────────────────────────────────────

  function createSession({ closeRaw, label, sendRaw }) {
    const session = {
      authed: false,
      closeRaw,
      closed: false,
      deviceId: null,
      garbage: 0,
      handshakeTimer: null,
      key: null,
      keyId: null,
      label,
      pairedDeviceId: null,
      pairedKey: null,
      sendRaw,
      seqIn: 0,
      seqOut: 0,
      upstream: null,
      upstreamTimer: null,
      upstreamAttempt: 0
    }

    session.handshakeTimer = setTimeout(() => {
      if (!session.authed) {
        closeSession(session, 'handshake-timeout')
      }
    }, HANDSHAKE_TIMEOUT_MS)
    session.handshakeTimer.unref?.()

    sessions.add(session)

    return session
  }

  function send(session, type, body) {
    if (session.closed || !session.key || !session.keyId) return false

    session.seqOut += 1

    try {
      session.sendRaw(sealEnvelope(session.key, session.keyId, session.seqOut, type, body))

      return true
    } catch (error) {
      log(`[mobile] send failed (${session.label}): ${error.message}`)
      closeSession(session, 'send-failed')

      return false
    }
  }

  function closeSession(session, reason) {
    if (session.closed) return

    session.closed = true
    clearTimeout(session.handshakeTimer)
    clearTimeout(session.upstreamTimer)

    if (session.upstream) {
      try {
        session.upstream.close()
      } catch {
        void 0
      }
      session.upstream = null
    }

    try {
      session.closeRaw()
    } catch {
      void 0
    }

    sessions.delete(session)
    log(`[mobile] session closed (${session.label}): ${reason}`)

    if (session.authed) {
      emitDevices()
    }
  }

  function strike(session, why) {
    session.garbage += 1
    log(`[mobile] dropped frame (${session.label}): ${why}`)

    if (session.garbage >= GARBAGE_FRAME_LIMIT) {
      closeSession(session, 'too-many-bad-frames')
    }
  }

  function handleFrame(session, text) {
    const outer = peekEnvelope(text)

    if (!outer) {
      strike(session, 'malformed envelope')

      return
    }

    // One connection, one identity — with a single sanctioned transition:
    // pair:<id> → dev:<newly minted id> right after pair.ok (same key bytes,
    // fresh seq space).
    if (session.keyId && outer.k !== session.keyId) {
      const promoted = session.pairedDeviceId && outer.k === `dev:${session.pairedDeviceId}`

      if (!promoted) {
        strike(session, `unexpected key id ${outer.k}`)

        return
      }

      session.keyId = outer.k
      session.seqIn = 0
    }

    if (!session.keyId) {
      const resolved = resolveSessionKey(session, outer.k)

      if (!resolved) return
    }

    let frame = null

    try {
      frame = openEnvelope(session.key, text)
    } catch {
      strike(session, 'undecryptable frame')

      return
    }

    if (frame.seq <= session.seqIn) {
      strike(session, `replayed seq ${frame.seq}`)

      return
    }

    session.seqIn = frame.seq
    routeFrame(session, frame)
  }

  /** First frame of a connection: bind the session to a pairing or device key. */
  function resolveSessionKey(session, keyId) {
    if (keyId.startsWith('pair:')) {
      const pairing = pairings.get(keyId.slice('pair:'.length))

      if (!pairing) {
        closeSession(session, 'unknown pairing')

        return false
      }

      session.key = pairing.key
      session.keyId = keyId
      session.pairing = pairing

      return true
    }

    if (keyId.startsWith('dev:')) {
      const device = store.getDevice(keyId.slice('dev:'.length))

      if (!device || !device.keyB64) {
        closeSession(session, 'unknown device')

        return false
      }

      session.key = Buffer.from(device.keyB64, 'base64url')
      session.keyId = keyId

      return true
    }

    closeSession(session, 'unsupported key id')

    return false
  }

  function routeFrame(session, frame) {
    switch (frame.type) {
      case 'pair.request':
        handlePairRequest(session, frame)

        return
      case 'hello':
        handleHello(session, frame)

        return
      case 'ping':
        send(session, 'pong', { ts: frame.body?.ts ?? now() })

        return
      default:
        break
    }

    if (!session.authed) {
      strike(session, `${frame.type} before hello`)

      return
    }

    switch (frame.type) {
      case 'rpc':
        handleRpc(session, frame)
        break
      case 'http':
        handleHttp(session, frame)
        break
      default:
        strike(session, `unknown frame type ${frame.type}`)
        break
    }
  }

  // ── Pairing + hello ──────────────────────────────────────────────────

  function handlePairRequest(session, frame) {
    const pairing = session.pairing

    if (!pairing || !session.keyId?.startsWith('pair:')) {
      strike(session, 'pair.request without pairing key')

      return
    }

    if (pairing.used) {
      send(session, 'pair.err', { code: 'used' })
      closeSession(session, 'pairing already used')

      return
    }

    if (pairing.expiresAt <= now()) {
      send(session, 'pair.err', { code: 'expired' })
      closeSession(session, 'pairing expired')

      return
    }

    pairing.used = true

    const name = typeof frame.body?.deviceName === 'string' && frame.body.deviceName.trim() ? frame.body.deviceName.trim().slice(0, 60) : 'iPhone'
    const model = typeof frame.body?.deviceModel === 'string' ? frame.body.deviceModel.slice(0, 60) : ''
    const { device, token } = store.addDevice({ keyB64: b64url(pairing.key), model, name })

    session.pairedDeviceId = device.id

    log(`[mobile] paired new device "${name}" (${device.id})`)
    send(session, 'pair.ok', { deviceId: device.id, deviceToken: token, hostName, protocol: 1 })
    emitDevices()
    emitStatus()
  }

  async function handleHello(session, frame) {
    if (!session.keyId?.startsWith('dev:')) {
      strike(session, 'hello without device key')

      return
    }

    const deviceId = session.keyId.slice('dev:'.length)
    const device = store.getDevice(deviceId)

    if (!device) {
      closeSession(session, 'unknown device at hello')

      return
    }

    if (device.revokedAt) {
      send(session, 'hello.err', { code: 'revoked' })
      closeSession(session, 'revoked device')

      return
    }

    if (!store.verifyDeviceToken(deviceId, frame.body?.deviceToken)) {
      send(session, 'hello.err', { code: 'unknown_device' })
      closeSession(session, 'bad device token')

      return
    }

    session.authed = true
    session.deviceId = deviceId
    clearTimeout(session.handshakeTimer)
    store.touchDevice(deviceId)

    const dashboard = await safeDashboard()

    send(session, 'hello.ok', {
      brain: dashboard ? 'ready' : 'starting',
      hostName,
      lan: collectLanUrls(lanPort),
      protocol: 1
    })

    connectUpstream(session)
    log(`[mobile] device "${device.name}" connected via ${session.label}`)
    emitDevices()
  }

  // ── RPC + HTTP proxying ──────────────────────────────────────────────

  async function safeDashboard() {
    try {
      return await getDashboard()
    } catch {
      return null
    }
  }

  function rpcError(session, id, message, code = -32000) {
    send(session, 'rpc', { frame: { error: { code, message }, id: id ?? null, jsonrpc: '2.0' } })
  }

  function handleRpc(session, frame) {
    const rpc = frame.body?.frame

    if (!rpc || typeof rpc !== 'object') {
      strike(session, 'rpc frame missing payload')

      return
    }

    if (typeof rpc.method === 'string' && !RPC_ALLOWED_METHODS.has(rpc.method)) {
      log(`[mobile] refused rpc method ${rpc.method} (${session.label})`)
      rpcError(session, rpc.id, `method not available from mobile: ${rpc.method}`, -32601)

      return
    }

    if (!session.upstream || session.upstream.readyState !== 1) {
      rpcError(session, rpc.id, 'Jarvis is still connecting — try again in a moment', -32002)

      return
    }

    try {
      session.upstream.send(JSON.stringify(rpc))

      if (SESSION_MUTATING_RPC_METHODS.has(rpc.method)) {
        emitActivity()
      }
    } catch (error) {
      rpcError(session, rpc.id, `upstream send failed: ${error.message}`)
    }
  }

  async function handleHttp(session, frame) {
    const { body, contentType, id, method, path: rawPath } = frame.body ?? {}

    if (typeof id !== 'string' && typeof id !== 'number') {
      strike(session, 'http frame missing id')

      return
    }

    const respond = (status, responseContentType = 'application/json', responseBody = null) => {
      send(session, 'http.res', {
        body: responseBody ? responseBody.toString('base64url') : '',
        contentType: responseContentType,
        id,
        status
      })
    }

    let pathname = null

    try {
      pathname = new URL(String(rawPath), 'http://mobile.invalid').pathname
    } catch {
      respond(400)

      return
    }

    const key = `${String(method || 'GET').toUpperCase()} ${pathname}`

    if (!isHttpAllowed(key)) {
      log(`[mobile] refused http ${key} (${session.label})`)
      respond(403)

      return
    }

    const dashboard = await safeDashboard()

    if (!dashboard) {
      respond(503)

      return
    }

    const requestBody = typeof body === 'string' && body ? Buffer.from(body, 'base64url') : undefined

    if (requestBody && requestBody.length > MAX_HTTP_BODY_BYTES) {
      respond(413)

      return
    }

    try {
      const response = await doFetch(`${dashboard.baseUrl}${rawPath}`, {
        body: requestBody,
        headers: {
          authorization: `Bearer ${dashboard.token}`,
          ...(contentType ? { 'content-type': String(contentType) } : {})
        },
        method: String(method || 'GET').toUpperCase()
      })

      const buffer = Buffer.from(await response.arrayBuffer())

      if (buffer.length > MAX_HTTP_BODY_BYTES) {
        respond(502)

        return
      }

      respond(response.status, response.headers.get('content-type') || 'application/octet-stream', buffer)

      const httpMethod = String(method || 'GET').toUpperCase()

      if (response.status < 400 && (httpMethod === 'PATCH' || httpMethod === 'DELETE')) {
        emitActivity()
      }
    } catch (error) {
      log(`[mobile] http proxy failed ${key}: ${error.message}`)
      respond(502)
    }
  }

  // ── Upstream (per-device dashboard socket) ───────────────────────────

  async function connectUpstream(session) {
    if (session.closed || session.upstream) return

    const dashboard = await safeDashboard()

    if (session.closed) return

    if (!dashboard) {
      scheduleUpstreamRetry(session)

      return
    }

    const wsUrl = `${dashboard.baseUrl.replace(/^http/, 'ws')}/api/ws?token=${encodeURIComponent(dashboard.token)}`
    const { WebSocket } = wsModule()

    let upstream = null

    try {
      upstream = new WebSocket(wsUrl)
    } catch (error) {
      log(`[mobile] upstream connect failed: ${error.message}`)
      scheduleUpstreamRetry(session)

      return
    }

    session.upstream = upstream

    upstream.on?.('open', () => {
      if (session.closed) return
      session.upstreamAttempt = 0
      send(session, 'upstream.status', { state: 'ready' })
    })

    upstream.on?.('message', data => {
      if (session.closed) return

      let parsed = null

      try {
        parsed = JSON.parse(String(data))
      } catch {
        return
      }

      // A phone-driven turn finishing changes titles/counts in the shared
      // session list — nudge the desktop to re-pull.
      if (parsed?.method === 'event' && parsed.params?.type === 'message.complete') {
        emitActivity()
      }

      send(session, 'rpc', { frame: parsed })
    })

    upstream.on?.('close', () => {
      if (session.upstream !== upstream) return
      session.upstream = null

      if (session.closed) return
      send(session, 'upstream.status', { state: 'down' })
      scheduleUpstreamRetry(session)
    })

    upstream.on?.('error', error => {
      log(`[mobile] upstream socket error (${session.label}): ${error.message}`)
    })
  }

  function scheduleUpstreamRetry(session) {
    if (session.closed || session.upstreamTimer) return

    const delay = Math.min(UPSTREAM_BACKOFF_MAX_MS, UPSTREAM_BACKOFF_BASE_MS * 2 ** session.upstreamAttempt)

    session.upstreamAttempt += 1
    session.upstreamTimer = setTimeout(() => {
      session.upstreamTimer = null
      connectUpstream(session)
    }, delay)
    session.upstreamTimer.unref?.()
  }

  // ── LAN server ───────────────────────────────────────────────────────

  async function startLanServer() {
    if (lanServer) return

    const { WebSocketServer } = wsModule()

    lanWss = new WebSocketServer({ noServer: true })

    lanServer = http.createServer((req, res) => {
      res.statusCode = 404
      res.end()
    })

    lanServer.on('upgrade', (req, socket, head) => {
      let pathname = null

      try {
        pathname = new URL(req.url, 'http://mobile.invalid').pathname
      } catch {
        socket.destroy()

        return
      }

      if (pathname !== '/link') {
        socket.write('HTTP/1.1 404 Not Found\r\n\r\n')
        socket.destroy()

        return
      }

      lanWss.handleUpgrade(req, socket, head, ws => {
        const label = `lan:${req.socket.remoteAddress || 'unknown'}`
        const session = createSession({
          closeRaw: () => ws.close(),
          label,
          sendRaw: text => ws.send(text)
        })

        ws.on('message', data => handleFrame(session, String(data)))
        ws.on('close', () => closeSession(session, 'socket closed'))
        ws.on('error', error => log(`[mobile] lan socket error: ${error.message}`))
      })
    })

    for (let attempt = 0; attempt < LAN_PORT_ATTEMPTS; attempt++) {
      const candidate = lanPortPreference + attempt

      try {
        await new Promise((resolve, reject) => {
          const onError = error => reject(error)

          lanServer.once('error', onError)
          lanServer.listen(candidate, '0.0.0.0', () => {
            lanServer.removeListener('error', onError)
            resolve()
          })
        })
        lanPort = candidate
        break
      } catch (error) {
        if (error.code !== 'EADDRINUSE' || attempt === LAN_PORT_ATTEMPTS - 1) {
          lanServer = null
          lanWss = null
          throw error
        }
      }
    }

    lastLanUrlsJson = JSON.stringify(collectLanUrls(lanPort))
    lanHintTimer = setInterval(() => {
      const urls = collectLanUrls(lanPort)
      const json = JSON.stringify(urls)

      if (json !== lastLanUrlsJson) {
        lastLanUrlsJson = json
        log('[mobile] LAN addresses changed — hinting connected devices')

        for (const session of sessions) {
          if (session.authed) {
            send(session, 'lan.hint', { lan: urls })
          }
        }
      }
    }, LAN_HINT_POLL_MS)
    lanHintTimer.unref?.()

    log(`[mobile] LAN link listening on 0.0.0.0:${lanPort}`)
  }

  function stopLanServer() {
    if (lanHintTimer) {
      clearInterval(lanHintTimer)
      lanHintTimer = null
    }

    if (lanWss) {
      for (const client of lanWss.clients || []) {
        try {
          client.close()
        } catch {
          void 0
        }
      }
      lanWss.close?.()
      lanWss = null
    }

    if (lanServer) {
      lanServer.close()
      lanServer = null
    }

    lanPort = null
  }

  // ── Relay uplink ─────────────────────────────────────────────────────

  const relaySessions = new Map()

  function startRelay() {
    const relayUrl = store.getConfig().relayUrl

    if (!relayUrl || relaySocket) return

    const endpoint = relayHostEndpoint(relayUrl, identity.hostId)
    const { WebSocket } = wsModule()
    const generation = ++relayGeneration

    let socket = null

    try {
      socket = new WebSocket(endpoint, { headers: { 'x-jarvis-host-key': identity.hostKey } })
    } catch (error) {
      log(`[mobile] relay connect failed: ${error.message}`)
      scheduleRelayReconnect()

      return
    }

    relaySocket = socket

    socket.on?.('open', () => {
      if (relayGeneration !== generation) return
      relayConnected = true
      relayAttempt = 0
      log(`[mobile] relay connected (${endpoint.replace(/\/host\/.*$/, '')})`)
      emitStatus()
    })

    socket.on?.('message', data => {
      if (relayGeneration !== generation) return

      let frame = null

      try {
        frame = JSON.parse(String(data))
      } catch {
        return
      }

      if (frame?.t === 'open' && typeof frame.cid === 'string') {
        const session = createSession({
          closeRaw: () => {
            try {
              socket.send(JSON.stringify({ cid: frame.cid, t: 'close' }))
            } catch {
              void 0
            }
          },
          label: `relay:${frame.cid}`,
          sendRaw: text => socket.send(JSON.stringify({ cid: frame.cid, d: text, t: 'msg' }))
        })

        relaySessions.set(frame.cid, session)
      } else if (frame?.t === 'msg' && typeof frame.cid === 'string' && typeof frame.d === 'string') {
        const session = relaySessions.get(frame.cid)

        if (session) handleFrame(session, frame.d)
      } else if (frame?.t === 'close' && typeof frame.cid === 'string') {
        const session = relaySessions.get(frame.cid)

        relaySessions.delete(frame.cid)

        if (session) closeSession(session, 'relay peer closed')
      }
    })

    const onDown = why => {
      if (relayGeneration !== generation) return

      relaySocket = null
      relayConnected = false

      for (const [cid, session] of relaySessions) {
        closeSession(session, `relay ${why}`)
        relaySessions.delete(cid)
      }

      emitStatus()

      if (enabled) scheduleRelayReconnect()
    }

    socket.on?.('close', () => onDown('closed'))
    socket.on?.('error', error => {
      log(`[mobile] relay socket error: ${error.message}`)
    })
  }

  function scheduleRelayReconnect() {
    if (relayTimer || !enabled) return

    const delay = Math.min(RELAY_BACKOFF_MAX_MS, RELAY_BACKOFF_BASE_MS * 2 ** relayAttempt)

    relayAttempt += 1
    relayTimer = setTimeout(() => {
      relayTimer = null
      if (enabled && !relaySocket) startRelay()
    }, delay)
    relayTimer.unref?.()
  }

  function stopRelay() {
    relayGeneration += 1

    if (relayTimer) {
      clearTimeout(relayTimer)
      relayTimer = null
    }

    if (relaySocket) {
      try {
        relaySocket.close()
      } catch {
        void 0
      }
      relaySocket = null
    }

    relayConnected = false

    for (const [cid, session] of relaySessions) {
      closeSession(session, 'relay stopped')
      relaySessions.delete(cid)
    }
  }

  // ── Public API ───────────────────────────────────────────────────────

  function getState() {
    const config = store.getConfig()

    return {
      devices: publicDevices(),
      enabled,
      hostId: identity?.hostId ?? null,
      hostName,
      lanPort,
      lanUrls: collectLanUrls(lanPort),
      relay: {
        connected: relayConnected,
        url: config.relayUrl || null
      }
    }
  }

  return {
    createPairing() {
      if (!enabled) {
        throw new Error('mobile access is disabled')
      }

      for (const [id, pairing] of pairings) {
        if (pairing.used || pairing.expiresAt <= now()) {
          pairings.delete(id)
        }
      }

      const pairingId = generateId(9)
      const key = generateLinkKey()
      const expiresAt = now() + PAIRING_TTL_MS

      pairings.set(pairingId, { expiresAt, key, used: false })

      const url = buildPairingUrl({
        expiresAt,
        hostId: identity.hostId,
        hostName,
        lanUrls: collectLanUrls(lanPort),
        linkKey: key,
        pairingId,
        relayUrl: store.getConfig().relayUrl || null
      })

      return { expiresAt, pairingId, url }
    },

    getState,

    revokeDevice(id) {
      const revoked = store.revokeDevice(id)

      if (revoked) {
        for (const session of [...sessions]) {
          if (session.deviceId === id) {
            send(session, 'hello.err', { code: 'revoked' })
            closeSession(session, 'device revoked')
          }
        }

        log(`[mobile] revoked device ${id}`)
        emitDevices()
        emitStatus()
      }

      return revoked
    },

    async setEnabled(next) {
      const value = Boolean(next)

      if (value === enabled) return getState()

      enabled = value
      store.setConfig({ enabled: value })

      if (value) {
        await startLanServer()
        startRelay()
      } else {
        for (const session of [...sessions]) {
          closeSession(session, 'mobile access disabled')
        }
        stopRelay()
        stopLanServer()
      }

      emitStatus()

      return getState()
    },

    setRelayUrl(url) {
      store.setConfig({ relayUrl: url ? String(url).trim() : null })
      stopRelay()
      relayAttempt = 0

      if (enabled) startRelay()

      emitStatus()

      return getState()
    },

    async start() {
      if (started) return

      started = true
      identity = store.ensureIdentity()

      const config = store.getConfig()

      if (config.enabled === true) {
        enabled = true

        try {
          await startLanServer()
        } catch (error) {
          log(`[mobile] LAN server failed to start: ${error.message}`)
        }

        startRelay()
      }

      emitStatus()
    },

    stop() {
      for (const session of [...sessions]) {
        closeSession(session, 'bridge stopped')
      }

      stopRelay()
      stopLanServer()
      started = false
    }
  }
}

module.exports = {
  HTTP_ALLOWED,
  LAN_PORT_DEFAULT,
  PAIRING_TTL_MS,
  RPC_ALLOWED_METHODS,
  collectLanUrls,
  createMobileBridge,
  isHttpAllowed,
  relayHostEndpoint
}

// ── Standalone mode (e2e testing without Electron) ─────────────────────
//
//   node mobile-bridge.cjs --dashboard-url http://127.0.0.1:PORT \
//        --token TOKEN [--lan-port 8776] [--data-dir /tmp/link] [--relay-url URL]
//
// Prints a pairing URL on stdin command "pair"; "state" dumps status JSON.
if (require.main === module) {
  const args = process.argv.slice(2)
  const readArg = name => {
    const index = args.indexOf(`--${name}`)

    return index >= 0 ? args[index + 1] : undefined
  }

  const dashboardUrl = readArg('dashboard-url') || process.env.JARVIS_DASHBOARD_URL
  const token = readArg('token') || process.env.JARVIS_DASHBOARD_TOKEN

  if (!dashboardUrl || !token) {
    console.error('usage: node mobile-bridge.cjs --dashboard-url http://127.0.0.1:PORT --token TOKEN')
    process.exit(2)
  }

  const bridge = createMobileBridge({
    getDashboard: async () => ({ baseUrl: dashboardUrl.replace(/\/$/, ''), token }),
    jarvisHome: readArg('data-dir') || undefined,
    lanPortPreference: Number(readArg('lan-port')) || LAN_PORT_DEFAULT,
    log: line => console.log(line)
  })

  bridge
    .start()
    .then(async () => {
      if (readArg('relay-url')) bridge.setRelayUrl(readArg('relay-url'))

      await bridge.setEnabled(true)
      console.log('[standalone] bridge ready — commands: pair | state | revoke <id> | quit')

      if (args.includes('--print-pairing')) {
        const pairing = bridge.createPairing()

        console.log(`[standalone] pairing url: ${pairing.url}`)
      }

      process.stdin.setEncoding('utf8')
      process.stdin.on('data', chunk => {
        for (const line of String(chunk).split('\n')) {
          const [command, argument] = line.trim().split(/\s+/)

          if (command === 'pair') {
            const pairing = bridge.createPairing()

            console.log(`[standalone] pairing url: ${pairing.url}`)
          } else if (command === 'state') {
            console.log(JSON.stringify(bridge.getState(), null, 2))
          } else if (command === 'revoke' && argument) {
            console.log(`[standalone] revoked: ${bridge.revokeDevice(argument)}`)
          } else if (command === 'quit') {
            bridge.stop()
            process.exit(0)
          }
        }
      })
    })
    .catch(error => {
      console.error(`[standalone] failed to start: ${error.message}`)
      process.exit(1)
    })
}
