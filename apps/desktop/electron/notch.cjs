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
const { execFile, spawn } = require('node:child_process')

const RELAUNCH_BASE_DELAY_MS = 1_000
const RELAUNCH_MAX_DELAY_MS = 30_000
// After this many consecutive unexpected exits (~1+2+4+8+16+30s of backoff,
// about a minute), stop auto-relaunching — a binary that can't survive one
// minute isn't going to fix itself on attempt 7. The notch stays offline
// (existing UI already surfaces this: the settings banner + Restart button)
// rather than looping forever in the background. Restart resets the count,
// so the user always has a manual way back in.
const MAX_RELAUNCH_ATTEMPTS = 6

/**
 * `require('ws')` normally resolves fine (dev mode; also packaged builds
 * where it happens to land in this package's own node_modules). But npm
 * workspace dedup hoists it to the repo root's node_modules when nothing
 * conflicts, which is out of reach of electron-builder's file collector once
 * `files:` is set in package.json (same class of bug stage-native-deps.cjs
 * already exists to fix for node-pty) — a packaged app then throws "Cannot
 * find module 'ws'" the first time this runs. Mirror that fix: ship a copy
 * under resources/native-deps/ws/ (see scripts/stage-native-deps.cjs) and
 * fall back to it when the normal require fails.
 */
function requireWs() {
  try {
    return require('ws')
  } catch (firstError) {
    const resourcesPath = process.resourcesPath
    if (!resourcesPath) throw firstError
    return require(path.join(resourcesPath, 'native-deps', 'ws'))
  }
}

// Static files the notch's embedded orb page may fetch from the renderer dist.
// Everything else 404s, and any path escaping the dist directory is refused.
const ORB_STATIC_TYPES = {
  '.css': 'text/css',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.map': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
}

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
 *   2. packaged: bundled inside the app's Resources
 *   3. the source checkout's xcodebuild output — `sourceRoots` covers the
 *      packaged app, whose __dirname lives inside app.asar: the installed app
 *      passes its update root (the repo it rebuilds itself from) so the notch
 *      built there launches with it.
 *   4. dev: the xcodebuild output relative to this file
 */
function resolveNotchAppPath({ env = process.env, isPackaged, resourcesPath, sourceRoots = [] }) {
  const candidates = []

  if (env.JARVIS_NOTCH_APP) {
    candidates.push(env.JARVIS_NOTCH_APP)
  }

  if (isPackaged && resourcesPath) {
    candidates.push(path.join(resourcesPath, 'Jarvis Notch.app'))
  }

  for (const root of sourceRoots) {
    if (!root) continue
    candidates.push(
      path.join(root, 'apps', 'notch', '.build', 'xcode', 'Build', 'Products', 'Release', 'Jarvis Notch.app'),
      path.join(root, 'apps', 'notch', '.build', 'xcode', 'Build', 'Products', 'Debug', 'Jarvis Notch.app')
    )
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

/** The notch build script inside a source checkout, if that checkout has one. */
function resolveNotchBuildScript(sourceRoots = []) {
  for (const root of sourceRoots) {
    if (!root) continue
    const script = path.join(root, 'apps', 'notch', 'scripts', 'build.sh')
    if (fs.existsSync(script)) {
      return script
    }
  }
  return null
}

/**
 * The orb page the notch embeds. In dev it lives on the Vite server (same
 * page the renderer runs from); in a built app the link's own HTTP server
 * serves it from the renderer dist. With neither available the notch draws
 * its native glow instead of a broken web view.
 */
function buildOrbUrl({ devServerUrl, port, rendererDistDir = null, token }) {
  if (devServerUrl) {
    const base = devServerUrl.endsWith('/') ? devServerUrl.slice(0, -1) : devServerUrl
    return `${base}/notch-orb.html?port=${port}&token=${encodeURIComponent(token)}`
  }

  if (rendererDistDir && fs.existsSync(path.join(rendererDistDir, 'notch-orb.html'))) {
    return `http://127.0.0.1:${port}/notch-orb.html?port=${port}&token=${encodeURIComponent(token)}`
  }

  return null
}

/**
 * Serve the orb page + its assets out of the renderer dist (loopback only,
 * GET only, no directory escapes). Static files carry no secrets — the WS
 * endpoint is what the token protects — so subresource requests, which cannot
 * attach the token, are allowed through unauthenticated.
 */
function serveOrbStatic(req, res, rendererDistDir) {
  if (!rendererDistDir || (req.method !== 'GET' && req.method !== 'HEAD')) {
    return false
  }

  let pathname = null
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname)
  } catch {
    return false
  }

  if (pathname === '/' || pathname === '/notch-orb') {
    pathname = '/notch-orb.html'
  }

  const type = ORB_STATIC_TYPES[path.extname(pathname).toLowerCase()]
  if (!type) {
    return false
  }

  const distRoot = path.resolve(rendererDistDir)
  const resolved = path.resolve(distRoot, `.${path.sep}${pathname.replaceAll('/', path.sep)}`)
  if (resolved !== distRoot && !resolved.startsWith(distRoot + path.sep)) {
    return false
  }

  let content = null
  try {
    content = fs.readFileSync(resolved)
  } catch {
    return false
  }

  res.statusCode = 200
  res.setHeader('content-type', type)
  res.setHeader('cache-control', 'no-store')
  res.end(req.method === 'HEAD' ? undefined : content)
  return true
}

function createNotchLink({
  log = () => {},
  devServerUrl = null,
  isPackaged = false,
  resourcesPath = null,
  rendererDistDir = null,
  sourceRoots = [],
  env = process.env,
  onCommand = () => {},
  onSettings = () => {},
  spawnImpl = spawn,
  killStaleImpl = null,
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
  let buildAttempted = false
  let restartRequested = false
  let userQuitRequested = false

  // Terminates the actual "Jarvis Notch" process by name. The Swift app is
  // launched via `open` (see spawnNotchApp — required to avoid a TCC
  // bundle-resolution crash when spawned directly), so the tracked `child`
  // handle is the `open` wrapper, not the app itself; killing `child` would
  // only kill that wrapper and leave the real app running. Exact-name match
  // so nothing else can be caught. Shared by the stale-instance cleanup on
  // start() and by stop()/restartNotch()'s termination.
  function killNotchProcess(callback) {
    const kill = killStaleImpl || (cb => execFile('pkill', ['-x', 'Jarvis Notch'], () => cb()))
    kill(callback)
  }

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
      case 'restartNotch':
        // Routed through here (not left to the notch relaunching itself)
        // because a self-relaunch loses the --jarvis-port/--jarvis-token
        // launch args, orphaning a disconnected instance while the connected
        // one dies. Only Jarvis knows the current port/token, so only Jarvis
        // can restart it correctly.
        restartNotch()
        break
      case 'userQuit':
        // Sent right before the notch's own Quit menu item terminates it.
        // open's own exit status doesn't distinguish "quit on purpose" from
        // "crashed" (see spawnNotchApp), so this explicit signal is what
        // does — consumed by the exit handler instead of an exit code.
        userQuitRequested = true
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
    const { WebSocketServer } = WebSocketServerImpl ? { WebSocketServer: WebSocketServerImpl } : requireWs()

    httpServer = http.createServer((req, res) => {
      // The HTTP surface serves the orb page + assets (built app; dev uses the
      // Vite server) and the WS upgrade. Everything else is denied.
      if (serveOrbStatic(req, res, rendererDistDir)) {
        return
      }
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
    state.orbUrl = buildOrbUrl({ devServerUrl, port, rendererDistDir, token })
    log(`[notch] link listening on 127.0.0.1:${port}`)
  }

  /**
   * No bundle anywhere → build one from the source checkout (the same repo
   * the installed app updates itself from), then launch it. Once per session,
   * best-effort: a failed build leaves the notch offline but never breaks the
   * app.
   */
  function buildNotchAppThenSpawn(buildScript) {
    if (buildAttempted) return
    buildAttempted = true

    log(`[notch] no built bundle found — building via ${buildScript} (first run takes a few minutes)`)
    const builder = spawnImpl('/bin/bash', [buildScript, 'build'], { detached: false, stdio: 'ignore' })

    builder.once('error', error => {
      log(`[notch] build failed to start: ${error.message}`)
    })

    builder.once('exit', code => {
      if (stopped) return
      if (code === 0) {
        log('[notch] build finished — launching')
        spawnNotchApp()
      } else {
        log(`[notch] build failed (${code}) — notch stays offline this session`)
      }
    })
  }

  function spawnNotchApp() {
    if (stopped) return

    const appPath = resolveNotchAppPath({ env, isPackaged, resourcesPath, sourceRoots })
    if (!appPath) {
      const buildScript = resolveNotchBuildScript(sourceRoots)
      if (buildScript && !buildAttempted) {
        buildNotchAppThenSpawn(buildScript)
      } else {
        log('[notch] Jarvis Notch.app not found — build it with apps/notch/scripts/build.sh (notch stays offline)')
      }
      return
    }

    // Launched via `open -W`, not a direct exec of the binary inside the
    // bundle: a directly-spawned child of Electron gets misattributed for
    // TCC's "responsible process" resolution, so the OS checks the WRONG
    // Info.plist for usage-description strings and the app immediately
    // SIGABRTs on its first privacy-sensitive API call (Bluetooth, in
    // practice) — even though the real Info.plist has the right keys.
    // Launching through LaunchServices (what `open` does) resolves the
    // bundle correctly. `-n` forces a fresh instance; `-W` makes `open`
    // itself block for as long as the launched app runs, so its own 'exit'
    // still fires when the real app quits — but `open`'s exit CODE reflects
    // whether the launch request succeeded, not how the app later exited,
    // so code/signal below are diagnostic only. Termination and "was this
    // deliberate" are handled explicitly: killNotchProcess() (not
    // child.kill(), which would only kill the `open` wrapper) and the
    // restartRequested/userQuitRequested flags, not exit codes.
    child = spawnImpl(
      'open',
      ['-n', '-W', '-a', appPath, '--args', '--jarvis-port', String(port), '--jarvis-token', token],
      { detached: false, stdio: 'ignore' }
    )

    child.once('error', error => {
      log(`[notch] failed to launch: ${error.message}`)
      child = null
    })

    child.once('exit', (code, signal) => {
      child = null
      if (stopped) return
      state.settings = { connected: false, permissions: state.settings.permissions, values: state.settings.values }
      onSettings(settingsSnapshot())

      // User-initiated restart: respawn immediately, skip the backoff and the
      // "clean exit → don't relaunch" convention below (both exist to respect
      // an intentional quit, and this is the opposite of that).
      if (restartRequested) {
        restartRequested = false
        relaunchAttempt = 0
        log('[notch] restarting')
        spawnNotchApp()
        return
      }

      // The notch has no reason to exit while Jarvis runs (its Quit menu item
      // is a user action we honor by NOT relaunching on clean exits).
      if (userQuitRequested) {
        userQuitRequested = false
        log('[notch] exited cleanly (user quit) — not relaunching')
        return
      }

      if (relaunchAttempt >= MAX_RELAUNCH_ATTEMPTS) {
        log(
          `[notch] exited unexpectedly (${signal || code}) — giving up after ${relaunchAttempt} attempts. ` +
            'Notch stays offline; use Settings → The Notch → Restart to try again.'
        )
        return
      }

      const delay = Math.min(RELAUNCH_MAX_DELAY_MS, RELAUNCH_BASE_DELAY_MS * 2 ** relaunchAttempt)
      relaunchAttempt += 1
      log(`[notch] exited unexpectedly (${signal || code}) — relaunching in ${delay}ms (attempt ${relaunchAttempt}/${MAX_RELAUNCH_ATTEMPTS})`)
      relaunchTimer = setTimeout(() => {
        relaunchTimer = null
        spawnNotchApp()
      }, delay)
    })

    // A launch that survives a while resets the crash-loop backoff. Compares
    // by reference (not just truthiness) against the outer `child` — without
    // that, a fast-crashing loop lets an EARLIER spawn's 60s timer fire while
    // a LATER spawn happens to be the current `child`, wrongly resetting the
    // counter for an attempt that never actually survived.
    const spawnedChild = child
    setTimeout(() => {
      if (child === spawnedChild) relaunchAttempt = 0
    }, 60_000).unref?.()

    log(`[notch] launched ${appPath}`)
  }

  function restartNotch() {
    if (stopped) return

    if (!child || child.killed) {
      // Nothing running (e.g. it crashed and is mid-backoff) — just spawn.
      if (relaunchTimer) {
        clearTimeout(relaunchTimer)
        relaunchTimer = null
      }
      relaunchAttempt = 0
      spawnNotchApp()
      return
    }

    restartRequested = true
    killNotchProcess(() => {})
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
    restartNotch,
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

      // A stale notch from a previous Jarvis run (crash, force-quit, dev
      // restart) holds a dead port+token — replace it, don't stack a second
      // notch on top.
      await new Promise(resolve => killNotchProcess(resolve))

      spawnNotchApp()
    },
    stop() {
      stopped = true
      if (relaunchTimer) {
        clearTimeout(relaunchTimer)
        relaunchTimer = null
      }
      if (child && !child.killed) {
        killNotchProcess(() => {})
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
  resolveNotchAppPath,
  resolveNotchBuildScript,
  serveOrbStatic
}
