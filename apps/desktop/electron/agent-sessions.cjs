/**
 * Agent sessions — read-and-drive access to the coding agents installed on
 * this Mac (Claude Code and OpenAI Codex CLI), so a paired phone can browse
 * their chats and send prompts into them remotely.
 *
 * Both CLIs persist append-only JSONL transcripts, which is what backs
 * session listing and cold history reads:
 *   - Claude Code: ~/.claude/projects/<encoded-cwd>/<session-uuid>.jsonl
 *   - Codex:       ~/.codex/sessions/YYYY/MM/DD/rollout-<ts>-<uuid>.jsonl
 *     (+ ~/.codex/session_index.jsonl mapping id → thread_name)
 *
 * Sending a message and live-tailing an OPEN session goes through two
 * persistent-process modules instead of a one-shot spawn per message:
 *   - claude-live-session.cjs: one long-lived `claude --input-format
 *     stream-json ...` process per actively-driven session — real
 *     mid-turn interrupt/steer and live model/plan-mode switching via its
 *     control_request channel.
 *   - codex-appserver-client.cjs: one shared `codex app-server` JSON-RPC
 *     daemon for the whole bridge, multiplexing many threads — real
 *     turn/steer, turn/interrupt, and collaboration-mode (plan) support.
 *
 * This module's own job is the integration layer: resolve a phone-visible
 * session id to the right provider call, merge the in-progress live turn
 * (assembled from each module's event stream) on top of the file-parsed
 * history so `readMessages` reflects what's actually happening right now,
 * and re-publish provider events as agent.* push notifications.
 *
 * No Jarvis gateway involvement: everything here is local files + local
 * processes, which is why it keeps working even while the brain is down.
 */

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')
const { spawn } = require('node:child_process')
const { defaultJarvisHome } = require('./mobile-link-store.cjs')
const { createClaudeLiveSession } = require('./claude-live-session.cjs')
const { createCodexAppServer } = require('./codex-appserver-client.cjs')

const PROVIDERS = ['claude', 'codex']
const CLAUDE_COMMANDS = new Set(['clear', 'compact', 'context'])
const CODEX_COMMANDS = new Set(['compact', 'rollback'])
// `claude setup-token` mints a long-lived (1yr) OAuth token meant exactly for
// headless/automation use — unlike the short-lived (~8h) interactive session
// token, it isn't dependent on a long-running process's background refresh
// timer, which is what made cold, one-off `claude -p` spawns intermittently
// report "Not logged in" (see claude-cli-headless-auth-gotcha memory).
const CLAUDE_AUTH_TOKEN_FILE = 'agent-auth.json'

const SESSION_LIST_LIMIT_MAX = 60
const MESSAGE_LIMIT_DEFAULT = 50
const MESSAGE_LIMIT_MAX = 120
// Relay frames ride Cloudflare DO websockets (1 MiB/message hard cap) and the
// rpc path has no chunking, so transcripts are capped well under it.
const TEXT_CAP = 6000
const THINKING_CAP = 3000
const TOOL_DETAIL_CAP = 160
const DIFF_CAP = 4000
const PLAN_CAP = 4000
const PROPOSED_PLAN_RE = /<proposed_plan>([\s\S]*?)<\/proposed_plan>/i
const TRANSCRIPT_READ_CAP_BYTES = 6 * 1024 * 1024
const WATCH_POLL_MS = 1200
// A transcript file touched this recently counts as "running" even if we
// didn't spawn the run ourselves (e.g. a session live in a terminal).
const RECENT_ACTIVITY_MS = 45_000

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

/**
 * Classifies a tool call into a rendering `kind` plus kind-specific
 * structured fields, so the phone can show a real diff/terminal/file path
 * instead of a generic one-line chip. Tool name vocabularies differ by
 * provider (Claude: Edit/Write/Read/Bash/Agent/...; Codex: shell/
 * apply_patch/spawn_agent/...) — handled together since both just need a
 * name + parsed-input pair. Codex's `update_plan` is NOT handled here — its
 * checklist shape doesn't fit "one tool call, one chip" and is built
 * directly where it's parsed (it replaces the whole list each call).
 */
function classifyTool(name, input) {
  const normalized = String(name || '').toLowerCase()

  if (!input || typeof input !== 'object') return { kind: 'tool' }

  if (normalized === 'edit') {
    return {
      kind: 'diff',
      newText: truncate(String(input.new_string ?? ''), DIFF_CAP),
      oldText: truncate(String(input.old_string ?? ''), DIFF_CAP),
      path: typeof input.file_path === 'string' ? input.file_path : null
    }
  }

  if (normalized === 'write') {
    return {
      kind: 'diff',
      newText: truncate(String(input.content ?? ''), DIFF_CAP),
      oldText: null,
      path: typeof input.file_path === 'string' ? input.file_path : null
    }
  }

  if (normalized === 'apply_patch' || normalized === 'apply-patch') {
    // The raw patch text's field name depends on how the caller wrapped it
    // (custom_tool_call's freeform `input` commonly arrives pre-wrapped as
    // `{command: ...}` by parseCodexTranscript, same as any other custom
    // tool) — check every plausible name rather than requiring the caller
    // to get the wrapping exactly right for this one tool.
    const patchText = [input.patch, input.input, input.command].find(value => typeof value === 'string') || ''

    return { kind: 'diff', newText: truncate(patchText, DIFF_CAP), oldText: null, path: null }
  }

  if (['read', 'glob', 'grep'].includes(normalized)) {
    return {
      kind: 'file',
      path: (typeof input.file_path === 'string' && input.file_path) || (typeof input.path === 'string' && input.path) || (typeof input.pattern === 'string' && input.pattern) || null
    }
  }

  if (['bash', 'shell', 'exec', 'exec_command', 'unified_exec'].includes(normalized)) {
    const rawCommand = input.command

    return {
      command: Array.isArray(rawCommand) ? rawCommand.join(' ') : (typeof rawCommand === 'string' ? rawCommand : null),
      kind: 'terminal'
    }
  }

  if (['agent', 'task', 'spawn_agent'].includes(normalized)) {
    return {
      description: truncate(String(input.description || input.goal || ''), TOOL_DETAIL_CAP),
      kind: 'agent',
      prompt: truncate(String(input.prompt || ''), DIFF_CAP)
    }
  }

  if (['websearch', 'web_search'].includes(normalized)) {
    return { kind: 'search', query: typeof input.query === 'string' ? input.query : null }
  }

  return { kind: 'tool' }
}

function finalizeTurn(turn, output) {
  if (!turn) return

  turn.text = truncate(turn.text.trim(), TEXT_CAP)
  turn.thinking = truncate(turn.thinking.trim(), THINKING_CAP)
  turn.plan = truncate((turn.plan || '').trim(), PLAN_CAP)

  // A model that ran a `<proposed_plan>` block (Codex plan mode) puts it
  // inline in the final message text — lift it into its own field so the
  // phone can render a dedicated plan card, same as Claude's ExitPlanMode.
  const match = !turn.plan && turn.text ? PROPOSED_PLAN_RE.exec(turn.text) : null

  if (match) {
    turn.plan = truncate(match[1].trim(), PLAN_CAP)
    turn.text = truncate((turn.text.slice(0, match.index) + turn.text.slice(match.index + match[0].length)).trim(), TEXT_CAP)
  }

  if (turn.text || turn.thinking || turn.plan || turn.tools.length || turn.checklist?.length) {
    output.push(turn)
  }
}

// ── Claude Code ────────────────────────────────────────────────────────

/** True for injected/meta user content the phone shouldn't render as a bubble. */
function isSyntheticUserText(text) {
  const trimmed = String(text || '').trimStart()

  return !trimmed || trimmed.startsWith('<')
}

function taskNotification(text) {
  const source = String(text || '').trim()

  if (!source.startsWith('<task-notification>')) return null

  const field = name => {
    const match = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(source)

    return match ? match[1].trim() : ''
  }
  const toolUseId = field('tool-use-id')

  if (!toolUseId) return null

  return {
    status: field('status'),
    summary: field('summary'),
    toolUseId
  }
}

function applyClaudeToolResult(tool, block) {
  if (!tool) return

  const output = contentBlocksText(block.content) || (typeof block.content === 'string' ? block.content : '')
  const launchedInBackground = /\b(?:running|launched) in background\b/i.test(output)

  tool.status = block.is_error === true ? 'failed' : (launchedInBackground ? 'running' : 'completed')
  tool.output = truncate(output, TOOL_DETAIL_CAP * 4)
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
          checklist: null,
          id: String(line.uuid || `a-${messages.length}`),
          plan: '',
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
          if (block.name === 'ExitPlanMode' && typeof block.input?.plan === 'string') {
            assistantTurn.plan = block.input.plan
            continue
          }

          if (block.name === 'EnterPlanMode') continue

          const tool = {
            id: String(block.id || `t-${assistantTurn.tools.length}`),
            name: String(block.name || 'tool'),
            detail: summarizeToolInput(block.name, block.input),
            status: 'running',
            ...classifyTool(block.name, block.input)
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

          applyClaudeToolResult(tool, block)
        }

        continue
      }

      const text = typeof content === 'string' ? content : contentBlocksText(content)
      const notification = taskNotification(text)

      if (notification) {
        const tool = toolsById.get(notification.toolUseId)

        if (tool) {
          tool.status = notification.status === 'failed' ? 'failed' : (notification.status === 'completed' ? 'completed' : 'running')
          if (notification.summary) tool.output = truncate(notification.summary, TOOL_DETAIL_CAP * 4)
        }

        continue
      }

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
        checklist: null,
        id: `a-${messages.length}`,
        plan: '',
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
      } else if (payload.type === 'mcp_tool_call_begin') {
        const turn = ensureAssistantTurn(line.timestamp)
        const invocation = payload.invocation || {}
        const tool = {
          detail: summarizeToolInput(invocation.tool, invocation.arguments) || String(invocation.server || ''),
          id: String(payload.call_id || `mcp-${turn.tools.length}`),
          kind: 'mcp',
          name: `${invocation.server || 'MCP'}: ${invocation.tool || 'tool'}`,
          output: '',
          status: 'running'
        }

        turn.tools.push(tool)
        toolsByCallId.set(tool.id, tool)
      } else if (payload.type === 'mcp_tool_call_end') {
        const turn = ensureAssistantTurn(line.timestamp)
        const invocation = payload.invocation || {}
        const id = String(payload.call_id || `mcp-${turn.tools.length}`)
        let tool = toolsByCallId.get(id)

        if (!tool) {
          tool = {
            detail: summarizeToolInput(invocation.tool, invocation.arguments) || String(invocation.server || ''),
            id,
            kind: 'mcp',
            name: `${invocation.server || 'MCP'}: ${invocation.tool || 'tool'}`,
            status: 'running'
          }
          turn.tools.push(tool)
          toolsByCallId.set(id, tool)
        }

        tool.output = codexOutput(payload.result)
        tool.status = payload.result && Object.prototype.hasOwnProperty.call(payload.result, 'Err') ? 'failed' : 'completed'
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
      let args = {}

      try {
        args = payload.type === 'function_call' ? JSON.parse(payload.arguments || '{}') : { command: payload.input }
      } catch {
        args = {}
      }

      // update_plan replaces the whole checklist each call — a running
      // task-list widget, not a one-off tool chip like everything else.
      if (payload.name === 'update_plan' && Array.isArray(args.plan)) {
        turn.checklist = args.plan
          .filter(item => item && typeof item.step === 'string')
          .map(item => ({ status: typeof item.status === 'string' ? item.status : 'pending', step: item.step }))
        continue
      }

      const detail = Object.keys(args).length ? summarizeToolInput(payload.name, args) : String(payload.arguments || '').slice(0, TOOL_DETAIL_CAP)
      const tool = {
        id: String(payload.call_id || `t-${turn.tools.length}`),
        name: String(payload.name || 'tool'),
        detail,
        status: 'running',
        ...classifyTool(payload.name, args)
      }

      turn.tools.push(tool)
      toolsByCallId.set(tool.id, tool)
    } else if (payload.type === 'function_call_output' || payload.type === 'custom_tool_call_output') {
      const tool = toolsByCallId.get(String(payload.call_id || ''))

      if (tool) {
        tool.status = codexToolFailed(payload.output) ? 'failed' : 'completed'
        tool.output = truncate(typeof payload.output === 'string' ? payload.output : '', TOOL_DETAIL_CAP * 4)
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

/** `{ claudeCodeOauthToken: "sk-ant-oat01-..." }` written once via `claude setup-token`. */
function readClaudeAuthToken(jarvisHome) {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(jarvisHome, CLAUDE_AUTH_TOKEN_FILE), 'utf8'))
    const token = typeof parsed.claudeCodeOauthToken === 'string' ? parsed.claudeCodeOauthToken.trim() : ''

    return token || null
  } catch {
    return null
  }
}

// ── Live turn accumulation ───────────────────────────────────────────────
//
// Both provider modules stream low-level protocol events (stream-json lines
// for Claude, JSON-RPC notifications for Codex) rather than parsed
// transcript turns. These functions fold those events into the SAME turn
// shape parseClaudeTranscript/parseCodexTranscript produce, so a live
// in-progress reply renders identically to a finished, file-parsed one —
// just updated incrementally instead of read once at the end.

function newLiveTurn() {
  return {
    _reasoningContent: '',
    _reasoningSummary: '',
    checklist: null,
    id: `live-${crypto.randomUUID()}`,
    plan: '',
    role: 'assistant',
    text: '',
    thinking: '',
    tools: [],
    ts: Date.now()
  }
}

/** Folds one Claude stream-json line into the session's live turn. Text and
 * thinking deltas are appended in event order rather than reconstructed by
 * content-block index — correct for the common case (blocks arrive
 * sequentially) and far simpler than a full Anthropic block-state machine. */
function applyClaudeLiveEvent(turn, message) {
  if (message.type === 'stream_event') {
    const event = message.event || {}

    if (event.type === 'content_block_start' && event.content_block?.type === 'tool_use') {
      // ExitPlanMode/EnterPlanMode aren't real tools from the phone's point
      // of view — the plan text itself is set once the full input is known,
      // at content_block_stop below.
      if (event.content_block.name === 'EnterPlanMode' || event.content_block.name === 'ExitPlanMode') {
        turn.tools.push({ _inputBuffer: '', _planMarker: true, id: String(event.content_block.id || `p-${turn.tools.length}`), name: event.content_block.name })

        return
      }

      turn.tools.push({
        id: String(event.content_block.id || `t-${turn.tools.length}`),
        name: String(event.content_block.name || 'tool'),
        detail: '',
        status: 'running',
        _inputBuffer: ''
      })
    } else if (event.type === 'content_block_delta') {
      const delta = event.delta || {}

      if (delta.type === 'text_delta' && typeof delta.text === 'string') {
        turn.text += delta.text
      } else if (delta.type === 'thinking_delta' && typeof delta.thinking === 'string') {
        turn.thinking += delta.thinking
      } else if (delta.type === 'input_json_delta' && typeof delta.partial_json === 'string') {
        const tool = turn.tools[turn.tools.length - 1]

        if (tool) tool._inputBuffer = (tool._inputBuffer || '') + delta.partial_json
      }
    } else if (event.type === 'content_block_stop') {
      const tool = turn.tools[turn.tools.length - 1]

      if (tool && tool._planMarker) {
        if (tool.name === 'ExitPlanMode') {
          try {
            const input = JSON.parse(tool._inputBuffer || '{}')

            if (typeof input.plan === 'string') turn.plan = input.plan
          } catch {
            void 0
          }
        }

        turn.tools.pop()
      } else if (tool && tool._inputBuffer !== undefined) {
        let parsedInput = {}

        try {
          parsedInput = JSON.parse(tool._inputBuffer || '{}')
        } catch {
          void 0
        }

        tool.detail = Object.keys(parsedInput).length ? summarizeToolInput(tool.name, parsedInput) : tool._inputBuffer.slice(0, TOOL_DETAIL_CAP)
        Object.assign(tool, classifyTool(tool.name, parsedInput))
        delete tool._inputBuffer
      }
    }
  } else if (message.type === 'user' && !message.isReplay) {
    // Tool results arrive on a synthetic user-typed line, same shape as the
    // on-disk transcript's tool_result blocks.
    const content = message.message?.content

    if (Array.isArray(content)) {
      for (const block of content) {
        if (block?.type !== 'tool_result') continue

        const tool = turn.tools.find(candidate => candidate.id === block.tool_use_id)

        applyClaudeToolResult(tool, block)
      }
    } else if (typeof content === 'string') {
      const notification = taskNotification(content)

      if (notification) {
        const tool = turn.tools.find(candidate => candidate.id === notification.toolUseId)

        if (tool) {
          tool.status = notification.status === 'failed' ? 'failed' : (notification.status === 'completed' ? 'completed' : 'running')
          if (notification.summary) tool.output = truncate(notification.summary, TOOL_DETAIL_CAP * 4)
        }
      }
    }
  }
}

function codexLiveStatus(item, completed) {
  if (item?.success === false || item?.status === 'failed' || item?.status === 'declined') return 'failed'
  if (completed || item?.status === 'completed') return 'completed'

  return 'running'
}

function codexArguments(value) {
  if (value && typeof value === 'object') return value
  if (typeof value !== 'string') return {}

  try {
    const parsed = JSON.parse(value)

    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return { input: value }
  }
}

function codexOutput(value) {
  if (typeof value === 'string') return truncate(value, TOOL_DETAIL_CAP * 4)
  if (value === undefined || value === null) return ''

  try {
    return truncate(JSON.stringify(value), TOOL_DETAIL_CAP * 4)
  } catch {
    return ''
  }
}

function upsertCodexTool(turn, id, fields) {
  let tool = turn.tools.find(candidate => candidate.id === String(id))

  if (!tool) {
    tool = { detail: '', id: String(id), kind: 'tool', name: 'Activity', status: 'running' }
    turn.tools.push(tool)
  }

  Object.assign(tool, fields)

  return tool
}

function replaceCodexFileChanges(turn, itemId, changes, status) {
  const prefix = `${itemId}:`

  turn.tools = turn.tools.filter(tool => !tool.id.startsWith(prefix))

  for (const [index, change] of changes.entries()) {
    if (!change || typeof change !== 'object') continue

    turn.tools.push({
      detail: typeof change.path === 'string' ? change.path : 'File change',
      id: `${prefix}${index}`,
      kind: 'diff',
      name: 'File change',
      newText: truncate(String(change.diff || ''), DIFF_CAP),
      oldText: null,
      path: typeof change.path === 'string' ? change.path : null,
      status
    })
  }
}

function updateCodexThinking(turn) {
  // Raw reasoning text is preferable when available; summary is the
  // documented fallback emitted by models that do not expose raw content.
  turn.thinking = turn._reasoningContent || turn._reasoningSummary
}

/** Fold one installed Codex app-server v2 notification into the same rich
 * turn shape used by the cold JSONL parser. Returns true when visible state
 * changed, allowing the bridge to avoid redundant phone updates. */
function applyCodexLiveEvent(turn, notification) {
  const params = notification.params || {}
  const item = notification.params?.item
  const completed = notification.method === 'item/completed'

  if (notification.method === 'item/agentMessage/delta' && typeof params.delta === 'string') {
    turn.text += params.delta

    return true
  }

  if (notification.method === 'item/plan/delta' && typeof params.delta === 'string') {
    turn.plan += params.delta

    return true
  }

  if ((notification.method === 'item/reasoning/textDelta' || notification.method === 'item/reasoning/summaryTextDelta') && typeof params.delta === 'string') {
    const field = notification.method === 'item/reasoning/textDelta' ? '_reasoningContent' : '_reasoningSummary'

    turn[field] += params.delta
    updateCodexThinking(turn)

    return true
  }

  if (notification.method === 'item/commandExecution/outputDelta' && typeof params.delta === 'string') {
    const tool = upsertCodexTool(turn, params.itemId || 'command', {
      kind: 'terminal',
      name: 'Command',
      status: 'running'
    })

    tool.output = truncate((tool.output || '') + params.delta, TOOL_DETAIL_CAP * 4)

    return true
  }

  if (notification.method === 'item/fileChange/patchUpdated' && Array.isArray(params.changes)) {
    replaceCodexFileChanges(turn, params.itemId || 'file-change', params.changes, 'running')

    return true
  }

  if (notification.method === 'turn/plan/updated' && Array.isArray(params.plan)) {
    turn.checklist = params.plan
      .filter(entry => entry && typeof entry.step === 'string')
      .map(entry => ({ status: typeof entry.status === 'string' ? entry.status : 'pending', step: entry.step }))

    return true
  }

  if (notification.method === 'turn/diff/updated' && typeof params.diff === 'string') {
    upsertCodexTool(turn, 'turn-diff', {
      detail: 'Current turn diff',
      kind: 'diff',
      name: 'Changes',
      newText: truncate(params.diff, DIFF_CAP),
      oldText: null,
      path: null,
      status: 'running'
    })

    return true
  }

  if (!item || item.type === 'userMessage' || item.type === 'hookPrompt') return false

  if (item.type === 'agentMessage') {
    if (typeof item.text === 'string') turn.text = item.text

    return true
  }

  if (item.type === 'plan') {
    if (typeof item.text === 'string') turn.plan = item.text

    return true
  }

  if (item.type === 'reasoning') {
    const content = Array.isArray(item.content) ? item.content.filter(value => typeof value === 'string').join('\n\n') : ''
    const summary = Array.isArray(item.summary) ? item.summary.filter(value => typeof value === 'string').join('\n\n') : ''

    if (content) turn._reasoningContent = content
    if (summary) turn._reasoningSummary = summary
    updateCodexThinking(turn)

    return true
  }

  if (item.type === 'commandExecution') {
    upsertCodexTool(turn, item.id || `command-${turn.tools.length}`, {
      command: typeof item.command === 'string' ? item.command : null,
      detail: typeof item.command === 'string' ? item.command.slice(0, TOOL_DETAIL_CAP) : 'Command',
      kind: 'terminal',
      name: 'Command',
      output: codexOutput(item.aggregatedOutput),
      status: codexLiveStatus(item, completed)
    })

    return true
  }

  if (item.type === 'fileChange') {
    const status = codexLiveStatus(item, completed)

    if (Array.isArray(item.changes) && item.changes.length) {
      replaceCodexFileChanges(turn, item.id || 'file-change', item.changes, status)
    } else {
      upsertCodexTool(turn, item.id || `file-change-${turn.tools.length}`, {
        detail: 'File change',
        kind: 'diff',
        name: 'File change',
        status
      })
    }

    return true
  }

  if (item.type === 'dynamicToolCall') {
    const args = codexArguments(item.arguments)

    if (item.tool === 'update_plan' && Array.isArray(args.plan)) {
      turn.checklist = args.plan
        .filter(entry => entry && typeof entry.step === 'string')
        .map(entry => ({ status: typeof entry.status === 'string' ? entry.status : 'pending', step: entry.step }))

      return true
    }

    upsertCodexTool(turn, item.id || `dynamic-${turn.tools.length}`, {
      detail: summarizeToolInput(item.tool, args),
      name: String(item.tool || 'Tool'),
      output: codexOutput(item.contentItems),
      status: codexLiveStatus(item, completed),
      ...classifyTool(item.tool, args)
    })

    return true
  }

  if (item.type === 'mcpToolCall') {
    const args = codexArguments(item.arguments)

    upsertCodexTool(turn, item.id || `mcp-${turn.tools.length}`, {
      detail: summarizeToolInput(item.tool, args) || String(item.server || ''),
      kind: 'mcp',
      name: `${item.server || 'MCP'}: ${item.tool || 'tool'}`,
      output: codexOutput(item.error || item.result),
      status: codexLiveStatus(item, completed)
    })

    return true
  }

  if (item.type === 'collabAgentToolCall') {
    upsertCodexTool(turn, item.id || `agent-${turn.tools.length}`, {
      description: String(item.tool || 'Agent task'),
      detail: String(item.tool || 'Agent task'),
      kind: 'agent',
      name: 'Agent',
      prompt: truncate(String(item.prompt || ''), DIFF_CAP),
      status: codexLiveStatus(item, completed)
    })

    return true
  }

  if (item.type === 'subAgentActivity') {
    upsertCodexTool(turn, item.id || `agent-${turn.tools.length}`, {
      description: `${item.kind || 'activity'} · ${item.agentPath || item.agentThreadId || 'sub-agent'}`,
      detail: String(item.agentPath || item.agentThreadId || item.kind || 'Sub-agent activity'),
      kind: 'agent',
      name: 'Sub-agent',
      prompt: '',
      status: completed ? 'completed' : 'running'
    })

    return true
  }

  if (item.type === 'webSearch') {
    upsertCodexTool(turn, item.id || `search-${turn.tools.length}`, {
      detail: String(item.query || ''),
      kind: 'search',
      name: 'Web search',
      query: typeof item.query === 'string' ? item.query : null,
      status: completed ? 'completed' : 'running'
    })

    return true
  }

  if (item.type === 'imageView') {
    upsertCodexTool(turn, item.id || `image-${turn.tools.length}`, {
      detail: String(item.path || ''),
      kind: 'file',
      name: 'View image',
      path: typeof item.path === 'string' ? item.path : null,
      status: completed ? 'completed' : 'running'
    })

    return true
  }

  upsertCodexTool(turn, item.id || `activity-${turn.tools.length}`, {
    detail: summarizeToolInput(item.type, item),
    name: String(item.type || 'Activity'),
    status: codexLiveStatus(item, completed),
    ...classifyTool(item.type, item)
  })

  return true
}

// ── Factory ────────────────────────────────────────────────────────────

function createAgentSessions({
  claudeDir = path.join(os.homedir(), '.claude'),
  codexDir = path.join(os.homedir(), '.codex'),
  jarvisHome = defaultJarvisHome(),
  log = () => {},
  now = Date.now,
  spawnImpl = spawn,
  claudeLiveSessionImpl = null,
  codexAppServerImpl = null
} = {}) {
  /** watchKey → { filePath, callbacks:Set } */
  const watchers = new Map()
  /** transcript metadata cache keyed by file path. */
  const metaCache = new Map()
  const runEventCallbacks = new Set()
  /** `${provider}:${sessionId}` → in-progress turn being assembled live. */
  const liveTurns = new Map()
  /** codex threadIds this app-server process instance has resumed/started. */
  const openCodexThreads = new Set()
  /** claude sessionIds with a pending "fresh session, id not chosen yet". */
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

    const env = { ...process.env, PATH: merged }
    const claudeToken = readClaudeAuthToken(jarvisHome)

    // Prefer the long-lived setup-token over whatever short-lived session
    // credential this Mac's interactive Claude Code happens to hold right
    // now — that one silently expires between phone-triggered spawns.
    if (claudeToken) {
      env.CLAUDE_CODE_OAUTH_TOKEN = claudeToken
    }

    return env
  }

  const claudeLive = claudeLiveSessionImpl || createClaudeLiveSession({
    binary: findBinary('claude'),
    log: message => log(`[claude-live] ${message}`),
    spawnEnv,
    spawnImpl
  })
  const codexAppServer = codexAppServerImpl || createCodexAppServer({
    binary: findBinary('codex'),
    log: message => log(`[codex-appserver] ${message}`),
    spawnEnv,
    spawnImpl
  })

  function liveTurnKey(provider, sessionId) {
    return `${provider}:${sessionId}`
  }

  function pushUpdate(provider, sessionId) {
    emitRunEvent({ provider, session_id: sessionId, type: 'agent.update' })
  }

  claudeLive.onEvent(({ message, sessionId }) => {
    const key = liveTurnKey('claude', sessionId)

    if (message.type === 'system' && message.subtype === 'init') {
      // A fresh turn is beginning; drop any stale accumulator.
      if (!message.isReplay) liveTurns.delete(key)
    } else if (message.type === 'result') {
      // Known, self-healing race: the CLI's stdout `result` line can arrive
      // a beat before its transcript file is flushed to disk, so a
      // readMessages() call in the instant right after this clears the live
      // turn can transiently see neither the live turn nor the file. Real
      // clients poll after an RPC round trip, which comfortably outlasts
      // this window — confirmed empirically, not worth retry complexity for.
      liveTurns.delete(key)
      pushUpdate('claude', sessionId)
      emitRunEvent({
        error: message.is_error ? (message.result || 'run failed') : null,
        ok: !message.is_error,
        provider: 'claude',
        session_id: sessionId,
        type: 'agent.run_done'
      })

      return
    } else {
      let turn = liveTurns.get(key)

      if (!turn) {
        turn = newLiveTurn()
        liveTurns.set(key, turn)
      }

      applyClaudeLiveEvent(turn, message)
    }

    pushUpdate('claude', sessionId)
  })

  codexAppServer.onNotification(notification => {
    const threadId = notification.params?.threadId

    if (!threadId) return

    const key = liveTurnKey('codex', threadId)

    if (notification.method === 'turn/started') {
      liveTurns.set(key, newLiveTurn())
      pushUpdate('codex', threadId)
    } else if (notification.method === 'turn/completed') {
      liveTurns.delete(key)
      pushUpdate('codex', threadId)

      const turn = notification.params.turn || {}

      emitRunEvent({
        error: turn.status === 'failed' ? (turn.error?.message || 'run failed') : null,
        ok: turn.status !== 'failed',
        provider: 'codex',
        session_id: threadId,
        type: 'agent.run_done'
      })
    } else {
      const turn = liveTurns.get(key)

      if (turn && applyCodexLiveEvent(turn, notification)) {
        pushUpdate('codex', threadId)
      }
    }
  })

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

  function liveRunning(provider, sessionId) {
    return provider === 'claude' ? claudeLive.isRunning(sessionId) : codexAppServer.isThreadRunning(sessionId)
  }

  function isRunning(provider, sessionId, mtimeMs) {
    if (liveRunning(provider, sessionId)) return true

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
      // A brand-new session that hasn't reached disk yet (first turn still
      // in flight) still has a live turn worth showing.
      const liveOnly = liveTurns.get(liveTurnKey(provider, sessionId))

      if (!liveOnly) return { error: 'session_not_found', messages: [] }

      return {
        cwd: null,
        messages: [stripLiveTurn(liveOnly)],
        model: null,
        running: true,
        sending: true,
        total: 1
      }
    }

    const lines = readJsonLines(file.filePath)
    const parsed = provider === 'claude' ? parseClaudeTranscript(lines) : parseCodexTranscript(lines)
    const capped = Math.max(1, Math.min(MESSAGE_LIMIT_MAX, Number(limit) || MESSAGE_LIMIT_DEFAULT))
    const live = liveTurns.get(liveTurnKey(provider, sessionId))
    const messages = live ? [...parsed.messages, stripLiveTurn(live)] : parsed.messages
    const total = messages.length

    return {
      cwd: parsed.cwd || transcriptMeta(provider, file).cwd,
      messages: messages.slice(-capped),
      model: parsed.model || null,
      running: isRunning(provider, sessionId, file.mtimeMs),
      sending: Boolean(live) || liveRunning(provider, sessionId),
      total
    }
  }

  /** Drop internal accumulator fields (e.g. Claude's raw JSON input buffer)
   * before a live turn is handed to a caller. */
  /** Explicit field allowlist (not a destructure-and-omit) so it's obvious
   * at a glance what actually reaches the phone, and so classifyTool()'s
   * kind-specific fields (path/oldText/newText/command/...) can't be
   * silently dropped by a future refactor the way an omit-list would allow. */
  function stripLiveTool(tool) {
    const clean = { detail: tool.detail, id: tool.id, kind: tool.kind || 'tool', name: tool.name, status: tool.status }

    for (const field of ['output', 'path', 'oldText', 'newText', 'command', 'description', 'prompt', 'query']) {
      if (tool[field] !== undefined) clean[field] = tool[field]
    }

    return clean
  }

  function stripLiveTurn(turn) {
    return {
      checklist: turn.checklist,
      id: turn.id,
      plan: turn.plan,
      role: turn.role,
      text: turn.text,
      thinking: turn.thinking,
      tools: turn.tools.filter(tool => !tool._planMarker).map(stripLiveTool),
      ts: turn.ts
    }
  }

  // ── Watching (file fallback, for activity this bridge didn't itself start) ──

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

  // ── Sending / steering / stopping ─────────────────────────────────────

  function resolveWorkDir(provider, sessionId, cwd) {
    let workDir = cwd

    if (sessionId && !workDir) {
      const file = findSessionFile(provider, sessionId)

      if (file) workDir = transcriptMeta(provider, file).cwd
    }

    if (!workDir || !fs.existsSync(workDir)) {
      workDir = os.homedir()
    }

    return workDir
  }

  async function ensureCodexThread(sessionId, cwd) {
    // `thread/resume` is safe to call even if this app-server process
    // already has the thread open — simpler and more robust than tracking
    // "did we already resume this" bookkeeping that would go stale across
    // an app-server crash/restart.
    const thread = sessionId
      ? await codexAppServer.resumeThread({ cwd, threadId: sessionId })
      : await codexAppServer.startThread({ cwd })

    openCodexThreads.add(thread.id)

    return thread
  }

  async function sendPrompt(provider, { sessionId = null, text, cwd = null, model, effort, planMode } = {}) {
    if (!PROVIDERS.includes(provider)) return { error: 'unknown_provider' }

    const prompt = String(text || '').trim()

    if (!prompt) return { error: 'empty_prompt' }

    const workDir = resolveWorkDir(provider, sessionId, cwd)

    try {
      if (provider === 'claude') {
        const claudeSessionId = sessionId || crypto.randomUUID()

        const options = {
          cwd: workDir,
          effort: effort || undefined,
          model: model || undefined,
          text: prompt
        }

        // Omission means "keep this live session's current mode". Treating
        // it as false here made every ordinary message silently exit plan
        // mode after agent.configure had enabled it.
        if (typeof planMode === 'boolean') {
          options.permissionMode = planMode ? 'plan' : 'acceptEdits'
        }

        await claudeLive.sendMessage(claudeSessionId, options)

        emitRunEvent({ provider, session_id: claudeSessionId, type: 'agent.run_started' })

        return { run_id: crypto.randomUUID(), session_id: claudeSessionId }
      }

      const thread = await ensureCodexThread(sessionId, workDir)

      await codexAppServer.startTurn({
        effort: effort || undefined,
        model: model || undefined,
        planMode: typeof planMode === 'boolean' ? planMode : undefined,
        text: prompt,
        threadId: thread.id
      })

      emitRunEvent({ provider, session_id: thread.id, type: 'agent.run_started' })

      return { run_id: crypto.randomUUID(), session_id: thread.id }
    } catch (error) {
      return { error: `send failed: ${error.message}` }
    }
  }

  /** True mid-turn redirect: Codex via turn/steer, Claude via interrupt +
   * immediate follow-up on the same live process (see claude-live-session's
   * `steer` for why that's the chosen emulation for Claude specifically). */
  async function steer(provider, { sessionId, text, cwd = null } = {}) {
    if (!PROVIDERS.includes(provider)) return { error: 'unknown_provider' }

    const prompt = String(text || '').trim()

    if (!prompt) return { error: 'empty_prompt' }
    if (!sessionId) return { error: 'session_not_found' }

    const workDir = resolveWorkDir(provider, sessionId, cwd)

    try {
      if (provider === 'claude') {
        await claudeLive.steer(sessionId, { cwd: workDir, text: prompt })

        return { ok: true }
      }

      await ensureCodexThread(sessionId, workDir)
      await codexAppServer.steerTurn({ text: prompt, threadId: sessionId })

      return { ok: true }
    } catch (error) {
      return { error: `steer failed: ${error.message}` }
    }
  }

  /** Live config change applied to an already-open session without waiting
   * for the next message — model/planMode apply immediately on both
   * providers; effort has no live channel on Claude (see claude-live-
   * session.cjs) and is deferred to the next spawn there. */
  async function configure(provider, { sessionId, model, effort, planMode } = {}) {
    if (!PROVIDERS.includes(provider)) return { error: 'unknown_provider' }
    if (!sessionId) return { error: 'session_not_found' }

    try {
      if (provider === 'claude') {
        return await claudeLive.configureLive(sessionId, { effort, model, planMode })
      }

      await ensureCodexThread(sessionId, null)
      await codexAppServer.updateThreadSettings({ effort, model, planMode, threadId: sessionId })

      return { applied: { effort, model, planMode }, deferred: false }
    } catch (error) {
      return { error: `configure failed: ${error.message}` }
    }
  }

  /** Provider-native quick commands exposed by the phone. Claude's three
   * commands are confirmed to work as literal stream-json user turns;
   * Codex has no slash-command wire convention, so its buttons map to the
   * equivalent app-server RPCs. */
  async function runCommand(provider, { command, cwd = null, sessionId } = {}) {
    if (!PROVIDERS.includes(provider)) return { error: 'unknown_provider' }
    if (!sessionId) return { error: 'session_not_found' }

    const name = String(command || '').replace(/^\//, '').trim().toLowerCase()

    try {
      if (provider === 'claude') {
        if (!CLAUDE_COMMANDS.has(name)) return { error: 'unknown_command' }

        return sendPrompt(provider, { cwd, sessionId, text: `/${name}` })
      }

      if (!CODEX_COMMANDS.has(name)) return { error: 'unknown_command' }

      const workDir = resolveWorkDir(provider, sessionId, cwd)

      await ensureCodexThread(sessionId, workDir)

      if (name === 'compact') {
        await codexAppServer.compactThread({ threadId: sessionId })
      } else {
        await codexAppServer.rollbackThread({ numTurns: 1, threadId: sessionId })
      }

      pushUpdate(provider, sessionId)

      return { ok: true }
    } catch (error) {
      return { error: `command failed: ${error.message}` }
    }
  }

  async function stop(provider, sessionId) {
    if (!PROVIDERS.includes(provider)) return { ok: false, reason: 'unknown_provider' }

    try {
      if (provider === 'claude') {
        return await claudeLive.interrupt(sessionId)
      }

      return await codexAppServer.interruptTurn({ threadId: sessionId })
    } catch (error) {
      return { ok: false, reason: error.message }
    }
  }

  function runningRuns() {
    const runs = []

    for (const [key] of liveTurns) {
      const [provider, sessionId] = key.split(':')

      runs.push({ provider, session_id: sessionId })
    }

    return runs
  }

  function dispose() {
    for (const [, entry] of watchers) {
      if (entry.filePath) fs.unwatchFile(entry.filePath)
    }

    watchers.clear()
    liveTurns.clear()
    openCodexThreads.clear()
    claudeLive.dispose()
    codexAppServer.dispose()
  }

  return {
    configure,
    dispose,
    listSessions,
    onRunEvent,
    providers,
    readMessages,
    runCommand,
    runningRuns,
    sendPrompt,
    steer,
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
  readClaudeAuthToken,
  summarizeToolInput,
  CLAUDE_AUTH_TOKEN_FILE
}
