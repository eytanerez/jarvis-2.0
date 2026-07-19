/**
 * Agent sessions — read-and-drive access to the coding agents installed on
 * this Mac (Claude Code and OpenAI Codex CLI), so a paired phone can browse
 * their chats and send prompts into them remotely.
 *
 * Both CLIs persist append-only JSONL transcripts:
 *   - Claude Code: ~/.claude/projects/<encoded-cwd>/<session-uuid>.jsonl
 *   - Codex:       ~/.codex/sessions/YYYY/MM/DD/rollout-<ts>-<uuid>.jsonl
 *     (+ ~/.codex/session_index.jsonl mapping id → thread_name)
 *
 * This module normalizes those two formats into one phone-friendly shape
 * (turns with text / thinking / tool chips), watches transcript files so an
 * open phone view can live-tail a running session, and sends new prompts by
 * spawning the CLIs headless:
 *   - claude -p --resume <id>   (prompt on stdin, stream-json on stdout)
 *   - codex exec resume <id>    (prompt as arg)
 *
 * No Jarvis gateway involvement: everything here is local files + local
 * processes, which is why it keeps working even while the brain is down.
 */

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')
const { spawn } = require('node:child_process')

const PROVIDERS = ['claude', 'codex']

const SESSION_LIST_LIMIT_MAX = 60
const MESSAGE_LIMIT_DEFAULT = 50
const MESSAGE_LIMIT_MAX = 120
// Relay frames ride Cloudflare DO websockets (1 MiB/message hard cap) and the
// rpc path has no chunking, so transcripts are capped well under it.
const TEXT_CAP = 6000
const THINKING_CAP = 3000
const TOOL_DETAIL_CAP = 160
const TRANSCRIPT_READ_CAP_BYTES = 6 * 1024 * 1024
const WATCH_POLL_MS = 1200
// A transcript file touched this recently counts as "running" even if we
// didn't spawn the run ourselves (e.g. a session live in a terminal).
const RECENT_ACTIVITY_MS = 45_000
const RUN_TIMEOUT_MS = 30 * 60_000

function truncate(text, cap) {
  if (typeof text !== 'string') return ''
  if (text.length <= cap) return text
  return `${text.slice(0, cap)}\n… [truncated]`
}

function toMs(iso) {
  const parsed = Date.parse(String(iso || ''))
  return Number.isFinite(parsed) ? parsed : null
}

function readJsonLines(filePath) {
  let raw = null

  try {
    const size = fs.statSync(filePath).size

    if (size > TRANSCRIPT_READ_CAP_BYTES) {
      // Tail the file: drop the first (possibly partial) line after seeking.
      const fd = fs.openSync(filePath, 'r')
      const buffer = Buffer.alloc(TRANSCRIPT_READ_CAP_BYTES)

      try {
        fs.readSync(fd, buffer, 0, TRANSCRIPT_READ_CAP_BYTES, size - TRANSCRIPT_READ_CAP_BYTES)
      } finally {
        fs.closeSync(fd)
      }

      raw = buffer.toString('utf8')
      raw = raw.slice(raw.indexOf('\n') + 1)
    } else {
      raw = fs.readFileSync(filePath, 'utf8')
    }
  } catch {
    return []
  }

  const lines = []

  for (const line of raw.split('\n')) {
    if (!line.trim()) continue

    try {
      lines.push(JSON.parse(line))
    } catch {
      // Mid-append partial line; skip.
    }
  }

  return lines
}

function contentBlocksText(content, blockType = 'text') {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''

  return content
    .filter(block => block && block.type === blockType && typeof block.text === 'string')
    .map(block => block.text)
    .join('')
}

/** A one-line human summary of a tool invocation's input. */
function summarizeToolInput(name, input) {
  if (!input || typeof input !== 'object') return ''

  const candidates = [input.command, input.file_path, input.path, input.pattern, input.query, input.url, input.description]

  for (const value of candidates) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim().replace(/\s+/g, ' ').slice(0, TOOL_DETAIL_CAP)
    }
  }

  try {
    return JSON.stringify(input).slice(0, TOOL_DETAIL_CAP)
  } catch {
    return ''
  }
}

function finalizeTurn(turn, output) {
  if (!turn) return

  turn.text = truncate(turn.text.trim(), TEXT_CAP)
  turn.thinking = truncate(turn.thinking.trim(), THINKING_CAP)

  if (turn.text || turn.thinking || turn.tools.length) {
    output.push(turn)
  }
}

// ── Claude Code ────────────────────────────────────────────────────────

/** True for injected/meta user content the phone shouldn't render as a bubble. */
function isSyntheticUserText(text) {
  const trimmed = String(text || '').trimStart()

  return !trimmed || trimmed.startsWith('<')
}

function parseClaudeTranscript(lines) {
  const messages = []
  let assistantTurn = null
  let model = null
  const toolsById = new Map()

  for (const line of lines) {
    if (!line || line.isSidechain === true || line.isMeta === true) continue

    const message = line.message

    if (line.type === 'assistant' && message) {
      if (!assistantTurn) {
        assistantTurn = {
          id: String(line.uuid || `a-${messages.length}`),
          role: 'assistant',
          text: '',
          thinking: '',
          tools: [],
          ts: toMs(line.timestamp)
        }
      }

      if (typeof message.model === 'string' && !message.model.startsWith('<')) {
        model = message.model
      }

      const blocks = Array.isArray(message.content) ? message.content : []

      for (const block of blocks) {
        if (!block) continue

        if (block.type === 'text' && typeof block.text === 'string') {
          assistantTurn.text += (assistantTurn.text ? '\n\n' : '') + block.text
        } else if (block.type === 'thinking' && typeof block.thinking === 'string') {
          assistantTurn.thinking += (assistantTurn.thinking ? '\n\n' : '') + block.thinking
        } else if (block.type === 'tool_use') {
          const tool = {
            id: String(block.id || `t-${assistantTurn.tools.length}`),
            name: String(block.name || 'tool'),
            detail: summarizeToolInput(block.name, block.input),
            status: 'running'
          }

          assistantTurn.tools.push(tool)
          toolsById.set(tool.id, tool)
        }
      }

      if (typeof message.content === 'string' && message.content.trim()) {
        assistantTurn.text += (assistantTurn.text ? '\n\n' : '') + message.content
      }
    } else if (line.type === 'user' && message) {
      const content = message.content

      // Tool results come back on user-typed lines — they close tool chips,
      // they are not user bubbles.
      if (Array.isArray(content) && content.some(block => block?.type === 'tool_result')) {
        for (const block of content) {
          if (block?.type !== 'tool_result') continue

          const tool = toolsById.get(String(block.tool_use_id || ''))

          if (tool) {
            tool.status = block.is_error === true ? 'failed' : 'completed'
          }
        }

        continue
      }

      const text = typeof content === 'string' ? content : contentBlocksText(content)

      if (isSyntheticUserText(text)) continue

      finalizeTurn(assistantTurn, messages)
      assistantTurn = null

      messages.push({
        id: String(line.uuid || `u-${messages.length}`),
        role: 'user',
        text: truncate(text.trim(), TEXT_CAP),
        thinking: '',
        tools: [],
        ts: toMs(line.timestamp)
      })
    }
  }

  finalizeTurn(assistantTurn, messages)

  return { messages, model }
}

/** First real user prompt in the file = the session title fallback. */
function claudeTitleFromLines(lines) {
  for (const line of lines) {
    if (line?.type !== 'user' || line.isSidechain === true || line.isMeta === true) continue

    const content = line.message?.content
    const text = typeof content === 'string' ? content : contentBlocksText(content)

    if (!isSyntheticUserText(text)) {
      return text.trim().replace(/\s+/g, ' ').slice(0, 80)
    }
  }

  return null
}

function claudeCwdFromLines(lines) {
  for (const line of lines) {
    if (typeof line?.cwd === 'string' && line.cwd) return line.cwd
  }

  return null
}

// ── Codex ──────────────────────────────────────────────────────────────

function isSyntheticCodexUserText(text) {
  const trimmed = String(text || '').trimStart()

  return !trimmed || /^<(environment_context|user_instructions|ENVIRONMENT_CONTEXT)/i.test(trimmed)
}

function codexToolFailed(output) {
  if (typeof output !== 'string') return false

  try {
    const parsed = JSON.parse(output)
    const exitCode = parsed?.metadata?.exit_code

    if (Number.isFinite(exitCode)) return exitCode !== 0

    if (parsed?.success === false) return true
  } catch {
    // Plain-text output — assume success.
  }

  return false
}

function parseCodexTranscript(lines) {
  const messages = []
  let assistantTurn = null
  let model = null
  let cwd = null
  const toolsByCallId = new Map()

  const ensureAssistantTurn = ts => {
    if (!assistantTurn) {
      assistantTurn = {
        id: `a-${messages.length}`,
        role: 'assistant',
        text: '',
        thinking: '',
        tools: [],
        ts: toMs(ts)
      }
    }

    return assistantTurn
  }

  for (const line of lines) {
    const payload = line?.payload

    if (!payload) continue

    if (line.type === 'session_meta') {
      if (typeof payload.cwd === 'string') cwd = payload.cwd
      continue
    }

    if (line.type === 'turn_context') {
      if (typeof payload.model === 'string' && payload.model) model = payload.model
      if (typeof payload.cwd === 'string' && payload.cwd) cwd = payload.cwd
      continue
    }

    if (line.type === 'event_msg') {
      if (payload.type === 'user_message') {
        if (isSyntheticCodexUserText(payload.message)) continue

        finalizeTurn(assistantTurn, messages)
        assistantTurn = null

        messages.push({
          id: `u-${messages.length}`,
          role: 'user',
          text: truncate(String(payload.message).trim(), TEXT_CAP),
          thinking: '',
          tools: [],
          ts: toMs(line.timestamp)
        })
      } else if (payload.type === 'agent_message' && typeof payload.message === 'string' && payload.message.trim()) {
        const turn = ensureAssistantTurn(line.timestamp)

        turn.text += (turn.text ? '\n\n' : '') + payload.message
      }

      continue
    }

    if (line.type !== 'response_item') continue

    if (payload.type === 'reasoning') {
      const summary = Array.isArray(payload.summary) ? payload.summary : []
      const text = summary
        .map(item => (typeof item === 'string' ? item : item?.text))
        .filter(item => typeof item === 'string' && item.trim())
        .join('\n\n')

      if (text) {
        const turn = ensureAssistantTurn(line.timestamp)

        turn.thinking += (turn.thinking ? '\n\n' : '') + text
      }
    } else if (payload.type === 'function_call' || payload.type === 'custom_tool_call') {
      const turn = ensureAssistantTurn(line.timestamp)
      let detail = ''

      try {
        const args = payload.type === 'function_call' ? JSON.parse(payload.arguments || '{}') : { command: payload.input }

        detail = summarizeToolInput(payload.name, args)
      } catch {
        detail = String(payload.arguments || '').slice(0, TOOL_DETAIL_CAP)
      }

      const tool = {
        id: String(payload.call_id || `t-${turn.tools.length}`),
        name: String(payload.name || 'tool'),
        detail,
        status: 'running'
      }

      turn.tools.push(tool)
      toolsByCallId.set(tool.id, tool)
    } else if (payload.type === 'function_call_output' || payload.type === 'custom_tool_call_output') {
      const tool = toolsByCallId.get(String(payload.call_id || ''))

      if (tool) {
        tool.status = codexToolFailed(payload.output) ? 'failed' : 'completed'
      }
    }
  }

  finalizeTurn(assistantTurn, messages)

  return { messages, model, cwd }
}

function codexSessionIdFromFilename(filename) {
  const match = /rollout-.*-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i.exec(filename)

  return match ? match[1] : null
}

// ── Factory ────────────────────────────────────────────────────────────

function createAgentSessions({
  claudeDir = path.join(os.homedir(), '.claude'),
  codexDir = path.join(os.homedir(), '.codex'),
  log = () => {},
  now = Date.now,
  spawnImpl = spawn
} = {}) {
  /** provider:sessionId → { child, startedAt, timer } */
  const runs = new Map()
  /** watchKey → { filePath, callbacks:Set } */
  const watchers = new Map()
  /** transcript metadata cache keyed by file path. */
  const metaCache = new Map()
  const runEventCallbacks = new Set()

  function emitRunEvent(event) {
    for (const callback of runEventCallbacks) {
      try {
        callback(event)
      } catch {
        void 0
      }
    }
  }

  function onRunEvent(callback) {
    runEventCallbacks.add(callback)

    return () => runEventCallbacks.delete(callback)
  }

  // ── Binary discovery ─────────────────────────────────────────────────

  function findBinary(name) {
    const candidates = [
      path.join(os.homedir(), '.local', 'bin', name),
      '/opt/homebrew/bin/' + name,
      '/usr/local/bin/' + name
    ]

    for (const candidate of candidates) {
      try {
        fs.accessSync(candidate, fs.constants.X_OK)

        return candidate
      } catch {
        void 0
      }
    }

    return name
  }

  function spawnEnv() {
    const extra = [path.join(os.homedir(), '.local', 'bin'), '/opt/homebrew/bin', '/usr/local/bin']
    const currentPath = process.env.PATH || ''
    const merged = [...extra.filter(entry => !currentPath.includes(entry)), currentPath].join(':')

    return { ...process.env, PATH: merged }
  }

  function providers() {
    const claudeAvailable = fs.existsSync(path.join(claudeDir, 'projects')) || findBinary('claude') !== 'claude'
    const codexAvailable = fs.existsSync(path.join(codexDir, 'sessions')) || findBinary('codex') !== 'codex'

    return [
      { id: 'claude', label: 'Claude Code', available: claudeAvailable },
      { id: 'codex', label: 'Codex', available: codexAvailable }
    ]
  }

  // ── Session discovery ────────────────────────────────────────────────

  function claudeSessionFiles() {
    const projectsDir = path.join(claudeDir, 'projects')
    const files = []
    let projectNames = []

    try {
      projectNames = fs.readdirSync(projectsDir)
    } catch {
      return files
    }

    for (const projectName of projectNames) {
      const projectDir = path.join(projectsDir, projectName)
      let entries = []

      try {
        entries = fs.readdirSync(projectDir)
      } catch {
        continue
      }

      for (const entry of entries) {
        if (!entry.endsWith('.jsonl')) continue

        const filePath = path.join(projectDir, entry)

        try {
          const stat = fs.statSync(filePath)

          if (stat.size === 0) continue

          files.push({ filePath, id: entry.slice(0, -'.jsonl'.length), mtimeMs: stat.mtimeMs })
        } catch {
          void 0
        }
      }
    }

    return files.sort((a, b) => b.mtimeMs - a.mtimeMs)
  }

  function codexSessionFiles() {
    const sessionsDir = path.join(codexDir, 'sessions')
    const files = []

    const walk = dir => {
      let entries = []

      try {
        entries = fs.readdirSync(dir, { withFileTypes: true })
      } catch {
        return
      }

      for (const entry of entries) {
        const entryPath = path.join(dir, entry.name)

        if (entry.isDirectory()) {
          walk(entryPath)
        } else if (entry.name.endsWith('.jsonl')) {
          const id = codexSessionIdFromFilename(entry.name)

          if (!id) continue

          try {
            const stat = fs.statSync(entryPath)

            if (stat.size === 0) continue

            files.push({ filePath: entryPath, id, mtimeMs: stat.mtimeMs })
          } catch {
            void 0
          }
        }
      }
    }

    walk(sessionsDir)

    return files.sort((a, b) => b.mtimeMs - a.mtimeMs)
  }

  function codexTitleIndex() {
    const titles = new Map()

    for (const line of readJsonLines(path.join(codexDir, 'session_index.jsonl'))) {
      if (line?.id && typeof line.thread_name === 'string' && line.thread_name.trim()) {
        titles.set(String(line.id), line.thread_name.trim())
      }
    }

    return titles
  }

  /** Cached per-file metadata (title, cwd) — recomputed only when mtime moves. */
  function transcriptMeta(provider, file) {
    const cached = metaCache.get(file.filePath)

    if (cached && cached.mtimeMs === file.mtimeMs) return cached

    const lines = readJsonLines(file.filePath)
    let meta = null

    if (provider === 'claude') {
      meta = {
        cwd: claudeCwdFromLines(lines),
        mtimeMs: file.mtimeMs,
        title: claudeTitleFromLines(lines)
      }
    } else {
      const parsed = parseCodexTranscript(lines)
      const firstUser = parsed.messages.find(message => message.role === 'user')

      meta = {
        cwd: parsed.cwd,
        mtimeMs: file.mtimeMs,
        title: firstUser ? firstUser.text.replace(/\s+/g, ' ').slice(0, 80) : null
      }
    }

    metaCache.set(file.filePath, meta)

    return meta
  }

  function sessionFiles(provider) {
    return provider === 'claude' ? claudeSessionFiles() : codexSessionFiles()
  }

  function findSessionFile(provider, sessionId) {
    return sessionFiles(provider).find(file => file.id === sessionId) || null
  }

  function isRunning(provider, sessionId, mtimeMs) {
    if (runs.has(`${provider}:${sessionId}`)) return true

    return Number.isFinite(mtimeMs) && now() - mtimeMs < RECENT_ACTIVITY_MS
  }

  function listSessions(provider, { limit = 30 } = {}) {
    const capped = Math.max(1, Math.min(SESSION_LIST_LIMIT_MAX, Number(limit) || 30))
    const files = sessionFiles(provider).slice(0, capped)
    const codexTitles = provider === 'codex' ? codexTitleIndex() : null

    return files.map(file => {
      const meta = transcriptMeta(provider, file)
      const indexTitle = codexTitles ? codexTitles.get(file.id) : null

      return {
        cwd: meta.cwd,
        id: file.id,
        provider,
        running: isRunning(provider, file.id, file.mtimeMs),
        title: indexTitle || meta.title || 'Untitled session',
        updated_at: Math.round(file.mtimeMs)
      }
    })
  }

  function readMessages(provider, sessionId, { limit = MESSAGE_LIMIT_DEFAULT } = {}) {
    const file = findSessionFile(provider, sessionId)

    if (!file) {
      return { error: 'session_not_found', messages: [] }
    }

    const lines = readJsonLines(file.filePath)
    const parsed = provider === 'claude' ? parseClaudeTranscript(lines) : parseCodexTranscript(lines)
    const capped = Math.max(1, Math.min(MESSAGE_LIMIT_MAX, Number(limit) || MESSAGE_LIMIT_DEFAULT))
    const total = parsed.messages.length
    const runKey = `${provider}:${sessionId}`
    const run = runs.get(runKey)

    return {
      cwd: parsed.cwd || transcriptMeta(provider, file).cwd,
      messages: parsed.messages.slice(-capped),
      model: parsed.model || null,
      running: isRunning(provider, sessionId, file.mtimeMs),
      sending: Boolean(run),
      total
    }
  }

  // ── Watching ─────────────────────────────────────────────────────────

  function watch(provider, sessionId, callback) {
    const key = `${provider}:${sessionId}`
    let entry = watchers.get(key)

    if (!entry) {
      const file = findSessionFile(provider, sessionId)

      entry = { callbacks: new Set(), filePath: file ? file.filePath : null }

      if (entry.filePath) {
        fs.watchFile(entry.filePath, { interval: WATCH_POLL_MS }, (current, previous) => {
          if (current.mtimeMs !== previous.mtimeMs || current.size !== previous.size) {
            for (const watcherCallback of entry.callbacks) {
              try {
                watcherCallback({ provider, session_id: sessionId })
              } catch {
                void 0
              }
            }
          }
        })
      }

      watchers.set(key, entry)
    }

    entry.callbacks.add(callback)

    return () => {
      entry.callbacks.delete(callback)

      if (entry.callbacks.size === 0) {
        if (entry.filePath) fs.unwatchFile(entry.filePath)
        watchers.delete(key)
      }
    }
  }

  // ── Sending prompts ──────────────────────────────────────────────────

  function buildSpawnPlan(provider, sessionId, text, cwd) {
    if (provider === 'claude') {
      const binary = findBinary('claude')

      if (sessionId) {
        return {
          args: ['-p', '--resume', sessionId, '--output-format', 'stream-json', '--verbose', '--permission-mode', 'acceptEdits'],
          binary,
          sessionId,
          stdin: text
        }
      }

      const freshId = crypto.randomUUID()

      return {
        args: ['-p', '--session-id', freshId, '--output-format', 'stream-json', '--verbose', '--permission-mode', 'acceptEdits'],
        binary,
        sessionId: freshId,
        stdin: text
      }
    }

    const binary = findBinary('codex')

    if (sessionId) {
      return {
        args: ['exec', 'resume', sessionId, '--skip-git-repo-check', '--json', '--', text],
        binary,
        sessionId,
        stdin: null
      }
    }

    return {
      args: ['exec', '--skip-git-repo-check', '--json', '--', text],
      binary,
      // Unknown until the CLI reports it (stdout JSON) or the rollout appears.
      sessionId: null,
      stdin: null
    }
  }

  /** Pull a session/thread id out of the CLIs' stdout JSON stream. */
  function extractSessionId(provider, parsed) {
    if (!parsed || typeof parsed !== 'object') return null

    if (provider === 'claude') {
      return typeof parsed.session_id === 'string' ? parsed.session_id : null
    }

    const candidates = [parsed.thread_id, parsed.session_id, parsed?.payload?.session_id, parsed?.payload?.id?.session_id, parsed?.payload?.id]

    for (const candidate of candidates) {
      if (typeof candidate === 'string' && /^[0-9a-f-]{36}$/i.test(candidate)) return candidate
    }

    return null
  }

  function sendPrompt(provider, { sessionId = null, text, cwd = null } = {}) {
    if (!PROVIDERS.includes(provider)) return { error: 'unknown_provider' }

    const prompt = String(text || '').trim()

    if (!prompt) return { error: 'empty_prompt' }

    let workDir = cwd

    if (sessionId && !workDir) {
      const file = findSessionFile(provider, sessionId)

      if (!file) return { error: 'session_not_found' }

      workDir = transcriptMeta(provider, file).cwd
    }

    if (!workDir || !fs.existsSync(workDir)) {
      workDir = os.homedir()
    }

    const plan = buildSpawnPlan(provider, sessionId, prompt, workDir)
    const runId = crypto.randomUUID()
    let child = null

    try {
      child = spawnImpl(plan.binary, plan.args, {
        cwd: workDir,
        env: spawnEnv(),
        stdio: ['pipe', 'pipe', 'pipe']
      })
    } catch (error) {
      return { error: `spawn failed: ${error.message}` }
    }

    // Provisional key for brand-new codex sessions (no id yet) — remapped as
    // soon as the CLI tells us the real one.
    let runKey = `${provider}:${plan.sessionId || runId}`
    const run = {
      child,
      provider,
      runId,
      sessionId: plan.sessionId,
      startedAt: now(),
      stderrTail: '',
      timer: null
    }

    runs.set(runKey, run)

    run.timer = setTimeout(() => {
      log(`[agents] run timed out (${runKey})`)

      try {
        child.kill('SIGKILL')
      } catch {
        void 0
      }
    }, RUN_TIMEOUT_MS)
    run.timer.unref?.()

    if (plan.stdin !== null) {
      try {
        child.stdin.write(plan.stdin)
        child.stdin.end()
      } catch {
        void 0
      }
    } else {
      try {
        child.stdin.end()
      } catch {
        void 0
      }
    }

    let stdoutBuffer = ''

    child.stdout?.on('data', chunk => {
      stdoutBuffer += String(chunk)

      let newlineIndex = stdoutBuffer.indexOf('\n')

      while (newlineIndex >= 0) {
        const line = stdoutBuffer.slice(0, newlineIndex).trim()

        stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1)
        newlineIndex = stdoutBuffer.indexOf('\n')

        if (!line) continue

        let parsed = null

        try {
          parsed = JSON.parse(line)
        } catch {
          continue
        }

        const discoveredId = extractSessionId(provider, parsed)

        if (discoveredId && discoveredId !== run.sessionId) {
          const previousId = run.sessionId

          run.sessionId = discoveredId
          runs.delete(runKey)
          runKey = `${provider}:${discoveredId}`
          runs.set(runKey, run)
          emitRunEvent({
            from_session_id: previousId,
            provider,
            run_id: runId,
            session_id: discoveredId,
            type: 'agent.session_resolved'
          })
        }
      }
    })

    child.stderr?.on('data', chunk => {
      run.stderrTail = (run.stderrTail + String(chunk)).slice(-2000)
    })

    child.on('error', error => {
      clearTimeout(run.timer)
      runs.delete(runKey)
      log(`[agents] run error (${runKey}): ${error.message}`)
      emitRunEvent({
        error: error.message,
        ok: false,
        provider,
        run_id: runId,
        session_id: run.sessionId,
        type: 'agent.run_done'
      })
    })

    child.on('exit', code => {
      clearTimeout(run.timer)
      runs.delete(runKey)

      const ok = code === 0

      if (!ok) {
        log(`[agents] run failed (${runKey}) exit=${code}: ${run.stderrTail.slice(-300)}`)
      }

      emitRunEvent({
        error: ok ? null : (run.stderrTail.trim().split('\n').pop() || `exit ${code}`),
        ok,
        provider,
        run_id: runId,
        session_id: run.sessionId,
        type: 'agent.run_done'
      })
    })

    emitRunEvent({
      provider,
      run_id: runId,
      session_id: run.sessionId,
      type: 'agent.run_started'
    })

    return { run_id: runId, session_id: run.sessionId }
  }

  function stop(provider, sessionId) {
    for (const [key, run] of runs) {
      if (run.provider === provider && (run.sessionId === sessionId || key === `${provider}:${sessionId}`)) {
        try {
          run.child.kill('SIGTERM')
        } catch {
          void 0
        }

        return true
      }
    }

    return false
  }

  function runningRuns() {
    return [...runs.values()].map(run => ({
      provider: run.provider,
      run_id: run.runId,
      session_id: run.sessionId,
      started_at: run.startedAt
    }))
  }

  function dispose() {
    for (const [, entry] of watchers) {
      if (entry.filePath) fs.unwatchFile(entry.filePath)
    }

    watchers.clear()

    for (const [, run] of runs) {
      clearTimeout(run.timer)

      try {
        run.child.kill('SIGKILL')
      } catch {
        void 0
      }
    }

    runs.clear()
  }

  return {
    dispose,
    listSessions,
    onRunEvent,
    providers,
    readMessages,
    runningRuns,
    sendPrompt,
    stop,
    watch
  }
}

module.exports = {
  createAgentSessions,
  // Exposed for tests.
  parseClaudeTranscript,
  parseCodexTranscript,
  codexSessionIdFromFilename,
  summarizeToolInput
}
