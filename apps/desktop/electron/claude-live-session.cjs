/**
 * Claude Code persistent-session manager — one long-lived
 * `claude -p --input-format stream-json --output-format stream-json
 * --include-partial-messages --replay-user-messages` process per phone
 * session the bridge is actively driving. Unlike codex-appserver-client.cjs
 * (one process, many threads), this protocol is inherently
 * single-conversation-per-process — confirmed no thread multiplexing — so
 * each actively-driven session gets its own child, reaped on idle.
 *
 * This module owns process lifecycle and the wire protocol only (parsing
 * stream-json lines, writing user messages and control_requests); turning
 * those into phone-renderable transcript turns is agent-sessions.cjs's job.
 *
 * Wire protocol reference: this session's research transcripts — apps/
 * desktop/electron scratchpad captures under claude-research/ (real
 * captured stream-json output for system/init, stream_event partial
 * deltas, assistant, result, and the control_request/control_response
 * interrupt round-trip — the only control_request subtype independently
 * live-verified here). set_permission_mode/set_model/set_max_thinking_tokens
 * shapes come from cross-referencing the public @anthropic-ai/claude-agent-
 * sdk source, not yet independently live-tested against the installed
 * binary — verify those three empirically as part of this module's test
 * pass (see claude-live-session.test.cjs).
 */

const crypto = require('node:crypto')
const { spawn } = require('node:child_process')

const CLAUDE_ARGS_BASE = [
  '-p',
  '--input-format', 'stream-json',
  '--output-format', 'stream-json',
  '--include-partial-messages',
  '--replay-user-messages',
  '--verbose'
]
const CONTROL_REQUEST_TIMEOUT_MS = 15_000
const DEFAULT_IDLE_EVICT_MS = 25 * 60_000

function createClaudeLiveSession({
  binary = 'claude',
  spawnImpl = spawn,
  spawnEnv = () => process.env,
  log = () => {},
  idleEvictMs = DEFAULT_IDLE_EVICT_MS,
  controlRequestTimeoutMs = CONTROL_REQUEST_TIMEOUT_MS,
  onEvict = () => {}
} = {}) {
  /** stored sessionId → live session state */
  const sessions = new Map()
  const eventHandlers = new Set()

  function onEvent(handler) {
    eventHandlers.add(handler)

    return () => eventHandlers.delete(handler)
  }

  function emit(sessionId, message) {
    for (const handler of eventHandlers) {
      try {
        handler({ message, sessionId })
      } catch {
        void 0
      }
    }
  }

  function makeState() {
    return {
      buffer: '',
      child: null,
      claudeSessionId: null,
      // Desired effort — freely updatable (configureLive, sendMessage
      // params) without touching a live process.
      effort: null,
      idleTimer: null,
      model: null,
      pendingControl: new Map(),
      permissionMode: 'acceptEdits',
      running: false,
      // What the CURRENTLY RUNNING process was actually spawned with —
      // separate from `effort` because there's no live control_request for
      // it (unlike model/permissionMode), so a desired-effort change must
      // be compared against what's actually live, not against itself.
      spawnedEffort: null
    }
  }

  function state(sessionId) {
    let existing = sessions.get(sessionId)

    if (!existing) {
      existing = makeState()
      sessions.set(sessionId, existing)
    }

    return existing
  }

  function touchActivity(sessionId, entry) {
    clearTimeout(entry.idleTimer)
    entry.idleTimer = setTimeout(() => evict(sessionId, 'idle'), idleEvictMs)
    entry.idleTimer.unref?.()
  }

  function rejectPendingControl(entry, error) {
    for (const [, control] of entry.pendingControl) {
      clearTimeout(control.timer)
      control.reject(error)
    }

    entry.pendingControl.clear()
  }

  function evict(sessionId, reason) {
    const entry = sessions.get(sessionId)

    if (!entry || !entry.child) return

    log(`[claude-live] evicting session ${sessionId} (${reason})`)

    try {
      entry.child.stdin.end()
    } catch {
      void 0
    }

    onEvict({ reason, sessionId })
  }

  function handleExit(sessionId, code, signal) {
    const entry = sessions.get(sessionId)

    if (!entry) return

    log(`[claude-live] process exited session=${sessionId} code=${code} signal=${signal}`)
    clearTimeout(entry.idleTimer)
    rejectPendingControl(entry, new Error('claude process exited'))
    entry.child = null
    entry.running = false
    entry.buffer = ''
  }

  function handleLine(sessionId, entry, line) {
    if (!line.trim()) return

    let message = null

    try {
      message = JSON.parse(line)
    } catch {
      log(`[claude-live] malformed line (${sessionId}): ${line.slice(0, 200)}`)

      return
    }

    if (message.type === 'system' && message.subtype === 'init' && message.session_id) {
      entry.claudeSessionId = message.session_id
    } else if (message.type === 'control_response') {
      const requestId = message.response?.request_id
      const control = requestId ? entry.pendingControl.get(requestId) : null

      if (control) {
        entry.pendingControl.delete(requestId)
        clearTimeout(control.timer)

        if (message.response?.subtype === 'error') {
          control.reject(new Error(message.response.error || 'control_request failed'))
        } else {
          control.resolve(message.response?.response ?? null)
        }
      }
    } else if (message.type === 'result') {
      entry.running = false
    }

    emit(sessionId, message)
  }

  function attachStdout(sessionId, entry, proc) {
    proc.stdout.setEncoding('utf8')
    proc.stdout.on('data', chunk => {
      entry.buffer += chunk

      let index = entry.buffer.indexOf('\n')

      while (index >= 0) {
        const line = entry.buffer.slice(0, index)

        entry.buffer = entry.buffer.slice(index + 1)
        handleLine(sessionId, entry, line)
        index = entry.buffer.indexOf('\n')
      }
    })
  }

  function buildSpawnArgs(sessionId, entry) {
    const args = [...CLAUDE_ARGS_BASE, '--permission-mode', entry.permissionMode]

    if (entry.model) args.push('--model', entry.model)
    if (entry.effort) args.push('--effort', entry.effort)

    if (entry.claudeSessionId) {
      args.push('--resume', entry.claudeSessionId)
    } else {
      entry.claudeSessionId = sessionId || crypto.randomUUID()
      args.push('--session-id', entry.claudeSessionId)
    }

    return args
  }

  /** Spawns a fresh process for this session if one isn't already alive. */
  function ensureProcess(sessionId, { cwd }) {
    const entry = state(sessionId)

    if (entry.child) return entry

    const args = buildSpawnArgs(sessionId, entry)
    const proc = spawnImpl(binary, args, {
      cwd,
      env: spawnEnv(),
      stdio: ['pipe', 'pipe', 'pipe']
    })

    entry.child = proc
    entry.buffer = ''
    entry.spawnedEffort = entry.effort
    attachStdout(sessionId, entry, proc)
    proc.stderr?.on('data', () => {})
    proc.on('exit', (code, signal) => handleExit(sessionId, code, signal))
    proc.on('error', error => {
      log(`[claude-live] spawn error (${sessionId}): ${error.message}`)
      handleExit(sessionId, null, null)
    })

    touchActivity(sessionId, entry)

    return entry
  }

  function writeLine(entry, payload) {
    if (!entry.child) throw new Error('no live claude process for this session')

    entry.child.stdin.write(`${JSON.stringify(payload)}\n`)
  }

  function sendControlRequest(sessionId, subtype, extra = {}, timeoutMs = controlRequestTimeoutMs) {
    const entry = state(sessionId)

    if (!entry.child) return Promise.reject(new Error('no live claude process for this session'))

    const requestId = crypto.randomUUID()

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        entry.pendingControl.delete(requestId)
        reject(new Error(`control_request timed out: ${subtype}`))
      }, timeoutMs)

      timer.unref?.()
      entry.pendingControl.set(requestId, { reject, resolve, timer })

      try {
        writeLine(entry, { request: { subtype, ...extra }, request_id: requestId, type: 'control_request' })
      } catch (error) {
        entry.pendingControl.delete(requestId)
        clearTimeout(timer)
        reject(error)
      }
    })
  }

  // ── Public surface ───────────────────────────────────────────────────

  /**
   * Send a user turn. Spawns the process on first use for a session, or
   * respawns it if the desired model/effort/permissionMode diverged from
   * what the currently-alive process was started with (effort has no live
   * control_request, so a change there always means a clean respawn).
   */
  async function sendMessage(sessionId, { cwd, effort, model, permissionMode, text }) {
    const entry = state(sessionId)

    if (effort !== undefined) entry.effort = effort
    if (model !== undefined) entry.model = model
    if (permissionMode !== undefined) entry.permissionMode = permissionMode

    // Effort has no live control_request — a desired value that diverges
    // from what the running process was actually spawned with (whether set
    // just now or earlier via configureLive) always means a respawn, even
    // if this particular call didn't pass `effort` itself.
    const needsRespawn = entry.child && entry.effort !== entry.spawnedEffort

    if (needsRespawn) {
      await stop(sessionId, { drainMs: 3_000 })
    }

    const live = ensureProcess(sessionId, { cwd })

    touchActivity(sessionId, live)
    live.running = true

    writeLine(live, { message: { content: [{ text, type: 'text' }], role: 'user' }, type: 'user' })
  }

  /** True interrupt: process survives and is immediately reusable. */
  async function interrupt(sessionId) {
    const entry = state(sessionId)

    if (!entry.child || !entry.running) return { ok: false, reason: 'not_running' }

    await sendControlRequest(sessionId, 'interrupt')

    return { ok: true }
  }

  /** Steer = interrupt the in-flight turn, then send the new text on the
   * same live process once it's confirmed idle (proven cheaper and more
   * reliable than racing a second stdin write against still-streaming
   * output). */
  async function steer(sessionId, { cwd, text }) {
    const entry = state(sessionId)

    if (entry.child && entry.running) {
      await sendControlRequest(sessionId, 'interrupt')
    }

    await sendMessage(sessionId, { cwd, text })
  }

  /** Live config changes. model/planMode apply instantly via control_request
   * when a process is up; effort has no live control_request (see module
   * doc) so it's always just recorded for the next spawn, live process or
   * not — returned under `pending`, never `applied`. */
  async function configureLive(sessionId, { model, planMode, effort }) {
    const entry = state(sessionId)
    const applied = {}
    const pending = {}

    if (effort !== undefined && effort !== entry.effort) {
      entry.effort = effort
      pending.effort = effort
    }

    if (!entry.child) {
      if (model !== undefined) entry.model = model
      if (planMode !== undefined) entry.permissionMode = planMode ? 'plan' : 'acceptEdits'

      return { applied, deferred: true, pending }
    }

    if (model !== undefined && model !== entry.model) {
      await sendControlRequest(sessionId, 'set_model', { model: model || null })
      entry.model = model
      applied.model = model
    }

    if (planMode !== undefined) {
      const mode = planMode ? 'plan' : 'acceptEdits'

      if (mode !== entry.permissionMode) {
        await sendControlRequest(sessionId, 'set_permission_mode', { mode })
        entry.permissionMode = mode
        applied.planMode = planMode
      }
    }

    return { applied, deferred: false, pending }
  }

  /** Graceful teardown: interrupt if running, then close stdin so the CLI
   * exits on its own rather than being signaled. */
  async function stop(sessionId, { drainMs = 5_000 } = {}) {
    const entry = sessions.get(sessionId)

    if (!entry || !entry.child) return

    const proc = entry.child

    if (entry.running) {
      try {
        await sendControlRequest(sessionId, 'interrupt')
      } catch {
        void 0
      }
    }

    // The process may have exited while we were awaiting the interrupt
    // (handleExit already cleared entry.child and rejected it in that
    // case) — nothing left to close.
    if (entry.child !== proc) return

    try {
      proc.stdin.end()
    } catch {
      void 0
    }

    await new Promise(resolve => {
      const timer = setTimeout(resolve, drainMs)

      timer.unref?.()
      proc.once('exit', () => {
        clearTimeout(timer)
        resolve()
      })
    })

    if (sessions.get(sessionId)?.child === proc) {
      try {
        proc.kill('SIGINT')
      } catch {
        void 0
      }
    }
  }

  function isRunning(sessionId) {
    return Boolean(sessions.get(sessionId)?.running)
  }

  function hasLiveProcess(sessionId) {
    return Boolean(sessions.get(sessionId)?.child)
  }

  function dispose() {
    for (const [, entry] of sessions) {
      clearTimeout(entry.idleTimer)
      rejectPendingControl(entry, new Error('bridge shutting down'))

      if (entry.child) {
        try {
          entry.child.kill('SIGINT')
        } catch {
          void 0
        }
      }
    }

    sessions.clear()
  }

  return {
    configureLive,
    dispose,
    hasLiveProcess,
    interrupt,
    isRunning,
    onEvent,
    sendMessage,
    steer,
    stop
  }
}

module.exports = { createClaudeLiveSession }
