/**
 * Codex app-server client — one long-lived `codex app-server --stdio`
 * process for the whole bridge, spoken to over NDJSON-framed JSON-RPC
 * (one JSON object per line, no Content-Length framing — confirmed by
 * capturing real traffic against the installed binary).
 *
 * app-server is the same daemon Codex Desktop drives: it multiplexes many
 * conversation threads inside one process (unlike the Claude CLI, which is
 * one conversation per process — see claude-live-session.cjs). This client
 * owns the process lifecycle, request/response correlation, and per-thread
 * turn-state tracking (running/idle, current turnId) that callers need to
 * steer/interrupt without re-deriving it from the notification stream
 * themselves.
 *
 * Wire protocol reference: this session's research transcripts —
 * apps/desktop/electron scratchpad captures under codex-research/ (real
 * request/response pairs for initialize, thread/start, turn/start,
 * turn/steer, turn/interrupt, collaborationMode/list) and the generated
 * JSON schemas (codex app-server generate-json-schema) for exact field
 * names or TurnStartParams/ThreadSettingsUpdateParams/ThreadResumeParams.
 */

const { spawn } = require('node:child_process')

const APP_SERVER_ARGS = ['app-server', '--listen', 'stdio://']
const INITIALIZE_TIMEOUT_MS = 15_000
const RPC_TIMEOUT_MS = 30_000
const CLIENT_INFO = { name: 'jarvis-mobile-bridge', version: '1.0.0' }

function createCodexAppServer({
  binary = 'codex',
  spawnImpl = spawn,
  spawnEnv = () => process.env,
  log = () => {}
} = {}) {
  let child = null
  let ready = false
  let starting = null
  let nextId = 0
  let stdoutBuffer = ''
  const pending = new Map()
  const notificationHandlers = new Set()
  /** threadId → current turn + sticky model settings returned by app-server. */
  const threads = new Map()

  function onNotification(handler) {
    notificationHandlers.add(handler)

    return () => notificationHandlers.delete(handler)
  }

  function emitNotification(message) {
    for (const handler of notificationHandlers) {
      try {
        handler(message)
      } catch {
        void 0
      }
    }
  }

  function threadState(threadId) {
    let state = threads.get(threadId)

    if (!state) {
      state = { effort: null, model: null, running: false, turnId: null }
      threads.set(threadId, state)
    }

    return state
  }

  function trackTurnLifecycle(message) {
    const params = message.params || {}
    const threadId = params.threadId

    if (!threadId) return

    if (message.method === 'turn/started') {
      const state = threadState(threadId)

      state.turnId = params.turn?.id || params.turnId || state.turnId
      state.running = true
    } else if (message.method === 'turn/completed') {
      threadState(threadId).running = false
    } else if (message.method === 'thread/status/changed') {
      threadState(threadId).running = params.status?.type === 'active'
    } else if (message.method === 'thread/settings/updated') {
      const settings = params.threadSettings || {}
      const state = threadState(threadId)

      if (typeof settings.model === 'string' && settings.model) state.model = settings.model
      if (settings.effort === null || typeof settings.effort === 'string') state.effort = settings.effort
    }
  }

  function rejectAllPending(error) {
    for (const [, entry] of pending) {
      clearTimeout(entry.timer)
      entry.reject(error)
    }

    pending.clear()
  }

  function handleLine(line) {
    if (!line.trim()) return

    let message = null

    try {
      message = JSON.parse(line)
    } catch {
      log(`[codex-appserver] malformed line: ${line.slice(0, 200)}`)

      return
    }

    if (message.id !== undefined && message.id !== null && (message.result !== undefined || message.error !== undefined)) {
      const entry = pending.get(message.id)

      if (!entry) return

      pending.delete(message.id)
      clearTimeout(entry.timer)

      if (message.error) {
        entry.reject(Object.assign(new Error(message.error.message || 'codex app-server error'), {
          code: message.error.code,
          data: message.error.data
        }))
      } else {
        entry.resolve(message.result)
      }

      return
    }

    if (message.method) {
      trackTurnLifecycle(message)
      emitNotification(message)
    }
  }

  function attachStdout(proc) {
    proc.stdout.setEncoding('utf8')
    proc.stdout.on('data', chunk => {
      stdoutBuffer += chunk

      let index = stdoutBuffer.indexOf('\n')

      while (index >= 0) {
        const line = stdoutBuffer.slice(0, index)

        stdoutBuffer = stdoutBuffer.slice(index + 1)
        handleLine(line)
        index = stdoutBuffer.indexOf('\n')
      }
    })
  }

  function handleExit(code, signal) {
    log(`[codex-appserver] process exited code=${code} signal=${signal}`)
    ready = false
    child = null
    starting = null
    stdoutBuffer = ''

    for (const [, state] of threads) {
      state.running = false
    }

    rejectAllPending(new Error('codex app-server exited'))
  }

  function sendRaw(proc, message) {
    proc.stdin.write(JSON.stringify(message) + '\n')
  }

  function callRaw(proc, method, params, timeoutMs) {
    return new Promise((resolve, reject) => {
      const id = ++nextId
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(new Error(`codex app-server timed out: ${method}`))
      }, timeoutMs)

      timer.unref?.()
      pending.set(id, { reject, resolve, timer })
      sendRaw(proc, { id, jsonrpc: '2.0', method, params })
    })
  }

  async function ensureStarted() {
    if (ready && child) return
    if (starting) return starting

    starting = (async () => {
      const proc = spawnImpl(binary, APP_SERVER_ARGS, {
        env: spawnEnv(),
        stdio: ['pipe', 'pipe', 'pipe']
      })

      child = proc
      attachStdout(proc)
      proc.stderr?.on('data', () => {})
      proc.on('exit', handleExit)
      proc.on('error', error => {
        log(`[codex-appserver] spawn error: ${error.message}`)
        handleExit(null, null)
      })

      await callRaw(proc, 'initialize', {
        capabilities: { experimentalApi: true },
        clientInfo: CLIENT_INFO
      }, INITIALIZE_TIMEOUT_MS)

      sendRaw(proc, { jsonrpc: '2.0', method: 'initialized' })
      ready = true
    })()

    try {
      await starting
    } finally {
      starting = null
    }
  }

  async function call(method, params = {}, timeoutMs = RPC_TIMEOUT_MS) {
    await ensureStarted()

    if (!child) throw new Error('codex app-server not running')

    return callRaw(child, method, params, timeoutMs)
  }

  // ── Thread/turn convenience surface ─────────────────────────────────

  async function startThread({ cwd }) {
    const result = await call('thread/start', { approvalPolicy: 'never', cwd, sandbox: 'workspace-write' })

    if (result.thread?.id) {
      const state = threadState(result.thread.id)

      if (typeof result.model === 'string' && result.model) state.model = result.model
      if (result.reasoningEffort === null || typeof result.reasoningEffort === 'string') state.effort = result.reasoningEffort
    }

    return result.thread
  }

  async function resumeThread({ threadId, cwd }) {
    const params = { threadId }

    if (cwd) params.cwd = cwd

    const result = await call('thread/resume', params)

    if (result.thread?.id) {
      const state = threadState(result.thread.id)

      if (typeof result.model === 'string' && result.model) state.model = result.model
      if (result.reasoningEffort === null || typeof result.reasoningEffort === 'string') state.effort = result.reasoningEffort
    }

    return result.thread
  }

  function collaborationModeParam(planMode, { effort, model, threadId }) {
    if (planMode === undefined) return undefined

    const state = threadState(threadId)
    const activeModel = typeof model === 'string' && model ? model : state.model

    if (!activeModel) {
      throw new Error('cannot change Codex collaboration mode before the thread model is known')
    }

    return {
      mode: planMode ? 'plan' : 'default',
      settings: {
        model: activeModel,
        reasoning_effort: effort === undefined ? state.effort : effort
      }
    }
  }

  async function startTurn({ effort, model, planMode, text, threadId }) {
    const params = { input: [{ text, type: 'text' }], threadId }

    if (effort !== undefined) params.effort = effort
    if (model !== undefined) params.model = model

    const collaborationMode = collaborationModeParam(planMode, { effort, model, threadId })

    if (collaborationMode) params.collaborationMode = collaborationMode

    const result = await call('turn/start', params)

    const state = threadState(threadId)

    state.turnId = result.turn?.id || null
    state.running = true
    if (typeof model === 'string' && model) state.model = model
    if (effort !== undefined) state.effort = effort

    return result.turn
  }

  async function steerTurn({ text, threadId }) {
    const state = threadState(threadId)

    if (!state.running || !state.turnId) {
      throw Object.assign(new Error('no active turn to steer'), { code: 'not_running' })
    }

    return call('turn/steer', { expectedTurnId: state.turnId, input: [{ text, type: 'text' }], threadId })
  }

  async function interruptTurn({ threadId }) {
    const state = threadState(threadId)

    if (!state.running || !state.turnId) {
      return { ok: false, reason: 'not_running' }
    }

    await call('turn/interrupt', { threadId, turnId: state.turnId })

    return { ok: true }
  }

  async function updateThreadSettings({ effort, model, planMode, threadId }) {
    const params = { threadId }

    if (effort !== undefined) params.effort = effort
    if (model !== undefined) params.model = model

    const collaborationMode = collaborationModeParam(planMode, { effort, model, threadId })

    if (collaborationMode) params.collaborationMode = collaborationMode

    const result = await call('thread/settings/update', params)
    const state = threadState(threadId)

    // A null override asks app-server to restore its configured default.
    // Keep the last known concrete model until thread/settings/updated
    // reports the resolved replacement; CollaborationMode.settings still
    // requires a non-null model even for the default mode.
    if (typeof model === 'string' && model) state.model = model
    if (effort !== undefined) state.effort = effort

    return result
  }

  async function compactThread({ threadId }) {
    return call('thread/compact/start', { threadId })
  }

  async function rollbackThread({ numTurns = 1, threadId }) {
    return call('thread/rollback', { numTurns, threadId })
  }

  function isThreadRunning(threadId) {
    return threadState(threadId).running
  }

  function dispose() {
    for (const [, entry] of pending) clearTimeout(entry.timer)

    pending.clear()
    threads.clear()

    if (child) {
      try {
        child.kill('SIGTERM')
      } catch {
        void 0
      }
    }

    child = null
    ready = false
    starting = null
  }

  return {
    call,
    compactThread,
    dispose,
    interruptTurn,
    isRunning: () => Boolean(child && ready),
    isThreadRunning,
    onNotification,
    resumeThread,
    rollbackThread,
    startThread,
    startTurn,
    steerTurn,
    updateThreadSettings
  }
}

module.exports = { createCodexAppServer }
