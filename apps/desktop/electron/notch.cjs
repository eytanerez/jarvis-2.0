/**
 * Jarvis Notch link — local IPC hub for the native notch companion app.
 *
 * The notch (apps/notch, a Swift app vendored from the old Jarvis build) owns
 * presentation at the top of the screen; ALL intelligence stays in this app.
 * This module is the seam between them:
 *
 *   - Hosts a loopback-only HTTP server with a WebSocket endpoint (`/notch`).
 *     Both the Swift app and the embedded orb web views connect to it. Every
 *     client must present the per-launch bearer token (header for the Swift
 *     client, `?token=` query for browser WebSocket, which cannot set
 *     headers).
 *   - Spawns / relaunches / kills `Jarvis Notch.app`, passing the port+token
 *     as launch arguments, so the notch lives and dies with Jarvis.
 *   - Caches the latest conversation state (phase / audio level / transcript /
 *     orb URL) and replays it as a snapshot to late-connecting clients, then
 *     broadcasts deltas as the renderer publishes them.
 *   - Routes notch-originated intents (start/end conversation, open the main
 *     window, open settings) back to the caller.
 *   - Mirrors the native notch settings snapshot into the renderer and sends
 *     setting / permission commands back to the Swift process.
 *
 * Messages are small JSON text frames in both directions; see
 * plans/the-notch-spec.md for the protocol.
 */

const crypto = require('node:crypto')
const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')
const { spawn } = require('node:child_process')

const RELAUNCH_BASE_DELAY_MS = 1_000
const RELAUNCH_MAX_DELAY_MS = 30_000

/** Extract the presented token from an upgrade/plain request (header or query). */
function requestToken(req) {
  const auth = req.headers?.authorization
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
    return auth.slice('Bearer '.length)
  }

  try {
    const url = new URL(req.url, 'http://127.0.0.1')
    return url.searchParams.get('token')
  } catch {
    return null
  }
}

/** Constant-time token comparison — a localhost server is still a boundary. */
function isAuthorized(req, token) {
  const presented = requestToken(req)
  if (!presented || typeof presented !== 'string') return false

  const a = Buffer.from(presented)
  const b = Buffer.from(token)
  if (a.length !== b.length) return false

  return crypto.timingSafeEqual(a, b)
}

/**
 * Resolve the notch app bundle. Priority:
 *   1. JARVIS_NOTCH_APP env override (points at a .app bundle)
 *   2. packaged: bundled inside the app's Resources (Phase 4)
 *   3. dev: the xcodebuild output in apps/notch
 */
function resolveNotchAppPath({ env = process.env, isPackaged, resourcesPath }) {
  const candidates = []

  if (env.JARVIS_NOTCH_APP) {
    candidates.push(env.JARVIS_NOTCH_APP)
  }

  if (isPackaged && resourcesPath) {
    candidates.push(path.join(resourcesPath, 'Jarvis Notch.app'))
  }

  candidates.push(
    path.join(__dirname, '..', '..', 'notch', '.build', 'xcode', 'Build', 'Products', 'Debug', 'Jarvis Notch.app'),
    path.join(__dirname, '..', '..', 'notch', '.build', 'xcode', 'Build', 'Products', 'Release', 'Jarvis Notch.app')
  )

  for (const candidate of candidates) {
    if (candidate && fs.existsSync(path.join(candidate, 'Contents', 'MacOS', 'Jarvis Notch'))) {
      return candidate
    }
  }

  return null
}

/**
 * The orb page the notch embeds. In dev it lives on the Vite server (same
 * page the renderer runs from); packaged serving ships with Phase 4 — until
 * then a packaged app sends no orb URL and the notch draws its native glow.
 */
function buildOrbUrl({ devServerUrl, port, token }) {
  if (devServerUrl) {
    const base = devServerUrl.endsWith('/') ? devServerUrl.slice(0, -1) : devServerUrl
    return `${base}/notch-orb.html?port=${port}&token=${encodeURIComponent(token)}`
  }

  return null
}

function createNotchLink({
  log = () => {},
  devServerUrl = null,
  isPackaged = false,
  resourcesPath = null,
  env = process.env,
  onCommand = () => {},
  onSettings = () => {},
  spawnImpl = spawn,
  WebSocketServerImpl = null
} = {}) {
  const token = crypto.randomBytes(32).toString('base64url')

  let httpServer = null
  let wss = null
  let port = null
  let child = null
  let stopped = false
  let relaunchTimer = null
  let relaunchAttempt = 0

  // Latest conversation state, replayed to every new client so a notch that
  // (re)connects mid-conversation renders the right thing immediately.
  const state = {
    orbUrl: null,
    phase: 'idle',
    transcript: [],
    settings: {
      connected: false,
      permissions: [],
      values: {}
    }
  }

  function broadcast(payload) {
    if (!wss) return
    const text = JSON.stringify(payload)
    for (const client of wss.clients) {
      if (client.readyState === 1) {
        client.send(text)
      }
    }
  }

  function snapshotMessages() {
    const messages = [
      { phase: state.phase, type: 'state' },
      { turns: state.transcript, type: 'transcript' }
    ]
    if (state.orbUrl) {
      messages.push({ type: 'orbUrl', url: state.orbUrl })
    }
    messages.push({ snapshot: state.settings, type: 'settingsSnapshot' })
    return messages
  }

  function settingsSnapshot() {
    return {
      connected: Boolean(state.settings.connected),
      permissions: Array.isArray(state.settings.permissions) ? state.settings.permissions : [],
      values:
        state.settings.values && typeof state.settings.values === 'object' && !Array.isArray(state.settings.values)
          ? state.settings.values
          : {}
    }
  }

  function updateSettingsSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') return

    state.settings = {
      connected: true,
      permissions: Array.isArray(snapshot.permissions) ? snapshot.permissions : state.settings.permissions,
      values:
        snapshot.values && typeof snapshot.values === 'object' && !Array.isArray(snapshot.values)
          ? snapshot.values
          : state.settings.values
    }

    onSettings(settingsSnapshot())
  }

  function sendToNative(payload) {
    if (!wss) return false

    const text = JSON.stringify(payload)
    let sent = false

    for (const client of wss.clients) {
      if (client.readyState === 1) {
        client.send(text)
        sent = true
      }
    }

    return sent
  }

  /** Called by the renderer (via main) with conversation updates. */
  function publish(payload) {
    if (!payload || typeof payload !== 'object') return

    switch (payload.type) {
      case 'state':
        if (typeof payload.phase === 'string') {
          state.phase = payload.phase
          broadcast({ phase: state.phase, type: 'state' })
        }
        break
      case 'audioLevel':
        if (typeof payload.level === 'number') {
          // High-frequency and ephemeral — broadcast without caching.
          broadcast({ level: payload.level, type: 'audioLevel' })
        }
        break
      case 'transcript':
        if (Array.isArray(payload.turns)) {
          state.transcript = payload.turns
          broadcast({ turns: state.transcript, type: 'transcript' })
        }
        break
      default:
        break
    }
  }

  function handleClientMessage(raw) {
    let message = null
    try {
      message = JSON.parse(String(raw))
    } catch {
      return
    }
    if (!message || typeof message.type !== 'string') return

    switch (message.type) {
      case 'hello':
        log(`[notch] client connected (protocol v${message.version ?? '?'})`)
        break
      case 'startConversation':
      case 'endConversation':
      case 'openMainWindow':
      case 'openSettings':
        onCommand(message)
        break
      case 'settingsSnapshot':
        updateSettingsSnapshot(message.snapshot)
        break
      case 'settingsChanged':
        updateSettingsSnapshot(message.snapshot)
        break
      default:
        break
    }
  }

  async function startServer() {
    // Lazy-required so unit tests can inject a fake without loading ws.
    const { WebSocketServer } = WebSocketServerImpl ? { WebSocketServer: WebSocketServerImpl } : require('ws')

    httpServer = http.createServer((req, res) => {
      // The HTTP surface exists only for the WS upgrade (and, in Phase 4,
      // static orb assets). Everything else is denied.
      res.statusCode = 404
      res.end()
    })

    wss = new WebSocketServer({ noServer: true })

    httpServer.on('upgrade', (req, socket, head) => {
      let pathname = null
      try {
        pathname = new URL(req.url, 'http://127.0.0.1').pathname
      } catch {
        socket.destroy()
        return
      }

      if (pathname !== '/notch' || !isAuthorized(req, token)) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
        socket.destroy()
        return
      }

      wss.handleUpgrade(req, socket, head, ws => {
        wss.emit('connection', ws, req)
      })
    })

    wss.on('connection', ws => {
      for (const message of snapshotMessages()) {
        ws.send(JSON.stringify(message))
      }
      ws.on('message', handleClientMessage)
      ws.on('error', error => log(`[notch] client socket error: ${error.message}`))
    })

    await new Promise((resolve, reject) => {
      httpServer.once('error', reject)
      httpServer.listen(0, '127.0.0.1', resolve)
    })

    port = httpServer.address().port
    state.orbUrl = buildOrbUrl({ devServerUrl, port, token })
    log(`[notch] link listening on 127.0.0.1:${port}`)
  }

  function spawnNotchApp() {
    if (stopped) return

    const appPath = resolveNotchAppPath({ env, isPackaged, resourcesPath })
    if (!appPath) {
      log('[notch] Jarvis Notch.app not found — build it with apps/notch/scripts/build.sh (notch stays offline)')
      return
    }

    const binary = path.join(appPath, 'Contents', 'MacOS', 'Jarvis Notch')
    child = spawnImpl(binary, ['--jarvis-port', String(port), '--jarvis-token', token], {
      detached: false,
      stdio: 'ignore'
    })

    child.once('error', error => {
      log(`[notch] failed to launch: ${error.message}`)
      child = null
    })

    child.once('exit', (code, signal) => {
      child = null
      if (stopped) return
      state.settings = { connected: false, permissions: state.settings.permissions, values: state.settings.values }
      onSettings(settingsSnapshot())

      // The notch has no reason to exit while Jarvis runs (its Quit menu item
      // is a user action we honor by NOT relaunching on clean exits).
      if (code === 0) {
        log('[notch] exited cleanly — not relaunching')
        return
      }

      const delay = Math.min(RELAUNCH_MAX_DELAY_MS, RELAUNCH_BASE_DELAY_MS * 2 ** relaunchAttempt)
      relaunchAttempt += 1
      log(`[notch] exited unexpectedly (${signal || code}) — relaunching in ${delay}ms`)
      relaunchTimer = setTimeout(() => {
        relaunchTimer = null
        spawnNotchApp()
      }, delay)
    })

    // A launch that survives a while resets the crash-loop backoff.
    setTimeout(() => {
      if (child) relaunchAttempt = 0
    }, 60_000).unref?.()

    log(`[notch] launched ${appPath}`)
  }

  return {
    get port() {
      return port
    },
    get token() {
      return token
    },
    get orbUrl() {
      return state.orbUrl
    },
    getSettingsSnapshot: settingsSnapshot,
    publish,
    requestPermission(id) {
      if (typeof id !== 'string' || !id) return false
      return sendToNative({ id, type: 'settingsPermissionRequest' })
    },
    setSetting(key, value) {
      if (typeof key !== 'string' || !key) return false
      return sendToNative({ key, type: 'settingsSet', value })
    },
    async start() {
      await startServer()
      spawnNotchApp()
    },
    stop() {
      stopped = true
      if (relaunchTimer) {
        clearTimeout(relaunchTimer)
        relaunchTimer = null
      }
      if (child && !child.killed) {
        child.kill('SIGTERM')
      }
      child = null
      state.settings = { connected: false, permissions: state.settings.permissions, values: state.settings.values }
      onSettings(settingsSnapshot())
      if (wss) {
        for (const client of wss.clients) {
          try {
            client.close()
          } catch {
            void 0
          }
        }
        wss.close()
        wss = null
      }
      if (httpServer) {
        httpServer.close()
        httpServer = null
      }
    }
  }
}

module.exports = {
  buildOrbUrl,
  createNotchLink,
  isAuthorized,
  resolveNotchAppPath
}
