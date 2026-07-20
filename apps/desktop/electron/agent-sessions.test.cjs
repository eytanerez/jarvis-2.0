const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { test } = require('node:test')

const {
  codexSessionIdFromFilename,
  createAgentSessions,
  parseClaudeTranscript,
  parseCodexTranscript,
  readClaudeAuthToken,
  summarizeToolInput
} = require('./agent-sessions.cjs')

// ── Claude transcript parsing ──────────────────────────────────────────

function claudeUserLine(text, uuid = 'u1', cwd = '/tmp/proj') {
  return { cwd, message: { content: text, role: 'user' }, timestamp: '2026-07-19T10:00:00Z', type: 'user', uuid }
}

test('claude: user + assistant text turns', () => {
  const { messages } = parseClaudeTranscript([
    claudeUserLine('hello there'),
    {
      message: { content: [{ text: 'hi!', type: 'text' }], model: 'claude-fable-5', role: 'assistant' },
      timestamp: '2026-07-19T10:00:05Z',
      type: 'assistant',
      uuid: 'a1'
    }
  ])

  assert.equal(messages.length, 2)
  assert.equal(messages[0].role, 'user')
  assert.equal(messages[0].text, 'hello there')
  assert.equal(messages[1].role, 'assistant')
  assert.equal(messages[1].text, 'hi!')
})

test('claude: model captured, thinking and tools merged into one turn, tool_result closes chip', () => {
  const { messages, model } = parseClaudeTranscript([
    claudeUserLine('run the tests'),
    {
      message: {
        content: [{ thinking: 'let me look', type: 'thinking' }, { id: 'tool-1', input: { command: 'npm test' }, name: 'Bash', type: 'tool_use' }],
        model: 'claude-fable-5',
        role: 'assistant'
      },
      type: 'assistant',
      uuid: 'a1'
    },
    // Tool result rides a user-typed line but is not a user bubble.
    { message: { content: [{ content: 'ok', tool_use_id: 'tool-1', type: 'tool_result' }], role: 'user' }, type: 'user', uuid: 'r1' },
    { message: { content: [{ text: 'all green', type: 'text' }], role: 'assistant' }, type: 'assistant', uuid: 'a2' }
  ])

  assert.equal(model, 'claude-fable-5')
  assert.equal(messages.length, 2)

  const turn = messages[1]

  assert.equal(turn.thinking, 'let me look')
  assert.equal(turn.text, 'all green')
  assert.equal(turn.tools.length, 1)
  assert.equal(turn.tools[0].name, 'Bash')
  assert.equal(turn.tools[0].detail, 'npm test')
  assert.equal(turn.tools[0].status, 'completed')
})

test('claude: failed tool_result marks chip failed; sidechain and synthetic lines skipped', () => {
  const { messages } = parseClaudeTranscript([
    claudeUserLine('<command-name>/clear</command-name>'),
    { isSidechain: true, message: { content: 'sidechain noise', role: 'user' }, type: 'user', uuid: 's1' },
    claudeUserLine('real prompt', 'u2'),
    {
      message: { content: [{ id: 'tool-1', input: { command: 'false' }, name: 'Bash', type: 'tool_use' }], role: 'assistant' },
      type: 'assistant',
      uuid: 'a1'
    },
    { message: { content: [{ content: 'boom', is_error: true, tool_use_id: 'tool-1', type: 'tool_result' }], role: 'user' }, type: 'user', uuid: 'r1' }
  ])

  assert.equal(messages.length, 2)
  assert.equal(messages[0].text, 'real prompt')
  assert.equal(messages[1].tools[0].status, 'failed')
})

test('claude: background tools remain live until their task notification arrives', () => {
  const toolId = 'tool-background'
  const launched = 'Command running in background with ID: task-1. You will be notified when it completes.'
  const { messages } = parseClaudeTranscript([
    claudeUserLine('run the long test'),
    {
      message: {
        content: [{ id: toolId, input: { command: 'npm test', run_in_background: true }, name: 'Bash', type: 'tool_use' }],
        role: 'assistant'
      },
      type: 'assistant',
      uuid: 'a1'
    },
    { message: { content: [{ content: launched, tool_use_id: toolId, type: 'tool_result' }], role: 'user' }, type: 'user', uuid: 'r1' },
    {
      message: {
        content: `<task-notification>\n<task-id>task-1</task-id>\n<tool-use-id>${toolId}</tool-use-id>\n<status>completed</status>\n<summary>Background command completed (exit code 0)</summary>\n</task-notification>`,
        role: 'user'
      },
      type: 'user',
      uuid: 'n1'
    }
  ])

  assert.equal(messages.length, 2, 'the notification must not become a user bubble')
  assert.equal(messages[1].tools[0].status, 'completed')
  assert.equal(messages[1].tools[0].output, 'Background command completed (exit code 0)')
})

// ── Codex transcript parsing ───────────────────────────────────────────

test('codex: meta, user/agent messages, reasoning, tool lifecycle', () => {
  const { cwd, messages, model } = parseCodexTranscript([
    { payload: { cwd: '/tmp/codex-proj', id: 'abc' }, timestamp: '2026-07-19T10:00:00Z', type: 'session_meta' },
    { payload: { cwd: '/tmp/codex-proj', model: 'gpt-5.2-codex' }, type: 'turn_context' },
    { payload: { message: 'fix the bug', type: 'user_message' }, timestamp: '2026-07-19T10:00:01Z', type: 'event_msg' },
    { payload: { summary: [{ text: 'thinking about it', type: 'summary_text' }], type: 'reasoning' }, type: 'response_item' },
    { payload: { arguments: '{"command":"ls -la"}', call_id: 'c1', name: 'shell', type: 'function_call' }, type: 'response_item' },
    { payload: { call_id: 'c1', output: '{"output":"files","metadata":{"exit_code":0}}', type: 'function_call_output' }, type: 'response_item' },
    { payload: { message: 'done, fixed it', phase: 'final', type: 'agent_message' }, type: 'event_msg' }
  ])

  assert.equal(cwd, '/tmp/codex-proj')
  assert.equal(model, 'gpt-5.2-codex')
  assert.equal(messages.length, 2)
  assert.equal(messages[0].role, 'user')
  assert.equal(messages[0].text, 'fix the bug')

  const turn = messages[1]

  assert.equal(turn.role, 'assistant')
  assert.equal(turn.thinking, 'thinking about it')
  assert.equal(turn.text, 'done, fixed it')
  assert.equal(turn.tools[0].name, 'shell')
  assert.equal(turn.tools[0].detail, 'ls -la')
  assert.equal(turn.tools[0].status, 'completed')
})

test('codex: nonzero exit marks tool failed; environment context skipped', () => {
  const { messages } = parseCodexTranscript([
    { payload: { message: '<ENVIRONMENT_CONTEXT>stuff</ENVIRONMENT_CONTEXT>', type: 'user_message' }, type: 'event_msg' },
    { payload: { message: 'do it', type: 'user_message' }, type: 'event_msg' },
    { payload: { arguments: '{"command":"false"}', call_id: 'c1', name: 'shell', type: 'function_call' }, type: 'response_item' },
    { payload: { call_id: 'c1', output: '{"output":"","metadata":{"exit_code":1}}', type: 'function_call_output' }, type: 'response_item' }
  ])

  assert.equal(messages.length, 2)
  assert.equal(messages[0].text, 'do it')
  assert.equal(messages[1].tools[0].status, 'failed')
})

test('codex: session id extracted from rollout filename', () => {
  assert.equal(
    codexSessionIdFromFilename('rollout-2026-07-17T02-09-43-019f6eb1-f1b9-7ac2-978d-f7781669ee83.jsonl'),
    '019f6eb1-f1b9-7ac2-978d-f7781669ee83'
  )
  assert.equal(codexSessionIdFromFilename('nope.jsonl'), null)
})

test('summarizeToolInput prefers command/path style fields', () => {
  assert.equal(summarizeToolInput('Bash', { command: 'ls' }), 'ls')
  assert.equal(summarizeToolInput('Read', { file_path: '/a/b.txt' }), '/a/b.txt')
})

// ── Rich rendering: diffs, terminal, plan text, checklist ──────────────

test('claude: Edit/Write tool_use blocks carry real diff content, not just a chip label', () => {
  const { messages } = parseClaudeTranscript([
    claudeUserLine('fix the bug'),
    {
      message: {
        content: [
          { id: 'e1', input: { file_path: '/tmp/a.txt', new_string: 'new', old_string: 'old' }, name: 'Edit', type: 'tool_use' },
          { id: 'w1', input: { content: 'brand new file', file_path: '/tmp/b.txt' }, name: 'Write', type: 'tool_use' }
        ],
        role: 'assistant'
      },
      type: 'assistant',
      uuid: 'a1'
    }
  ])

  const [editTool, writeTool] = messages[1].tools

  assert.equal(editTool.kind, 'diff')
  assert.equal(editTool.path, '/tmp/a.txt')
  assert.equal(editTool.oldText, 'old')
  assert.equal(editTool.newText, 'new')

  assert.equal(writeTool.kind, 'diff')
  assert.equal(writeTool.oldText, null)
  assert.equal(writeTool.newText, 'brand new file')
})

test('claude: Bash tool_result output is captured; ExitPlanMode sets turn.plan instead of a tool chip', () => {
  const { messages } = parseClaudeTranscript([
    claudeUserLine('run tests then propose a plan'),
    {
      message: {
        content: [
          { id: 't1', input: { command: 'npm test' }, name: 'Bash', type: 'tool_use' },
          { id: 'p1', input: { plan: '1. Do the thing\n2. Ship it' }, name: 'ExitPlanMode', type: 'tool_use' }
        ],
        role: 'assistant'
      },
      type: 'assistant',
      uuid: 'a1'
    },
    { message: { content: [{ content: 'all green', tool_use_id: 't1', type: 'tool_result' }], role: 'user' }, type: 'user', uuid: 'r1' }
  ])

  const turn = messages[1]

  assert.equal(turn.tools.length, 1, 'ExitPlanMode must not appear as a tool chip')
  assert.equal(turn.tools[0].kind, 'terminal')
  assert.equal(turn.tools[0].command, 'npm test')
  assert.equal(turn.tools[0].output, 'all green')
  assert.equal(turn.plan, '1. Do the thing\n2. Ship it')
})

test('codex: update_plan becomes turn.checklist, not a tool chip; apply_patch classified as a diff', () => {
  const { messages } = parseCodexTranscript([
    { payload: { message: 'ship it', type: 'user_message' }, type: 'event_msg' },
    {
      payload: {
        arguments: JSON.stringify({ plan: [{ status: 'completed', step: 'write code' }, { status: 'in_progress', step: 'test it' }] }),
        call_id: 'c1',
        name: 'update_plan',
        type: 'function_call'
      },
      type: 'response_item'
    },
    { payload: { call_id: 'c2', input: '--- a/x\n+++ b/x\n', name: 'apply_patch', type: 'custom_tool_call' }, type: 'response_item' },
    { payload: { message: 'done', type: 'agent_message' }, type: 'event_msg' }
  ])

  const turn = messages[1]

  assert.deepEqual(turn.checklist, [{ status: 'completed', step: 'write code' }, { status: 'in_progress', step: 'test it' }])
  assert.equal(turn.tools.length, 1, 'update_plan must not also appear as a tool chip')
  assert.equal(turn.tools[0].kind, 'diff')
  assert.equal(turn.tools[0].newText, '--- a/x\n+++ b/x\n')
})

test('codex: MCP calls retain their provider-native kind and result', () => {
  const { messages } = parseCodexTranscript([
    { payload: { message: 'look it up', type: 'user_message' }, type: 'event_msg' },
    {
      payload: {
        call_id: 'mcp-1',
        invocation: { arguments: { query: 'open pull requests' }, server: 'github', tool: 'search_pull_requests' },
        type: 'mcp_tool_call_begin'
      },
      type: 'event_msg'
    },
    {
      payload: {
        call_id: 'mcp-1',
        invocation: { arguments: { query: 'open pull requests' }, server: 'github', tool: 'search_pull_requests' },
        result: { Ok: { content: [{ text: 'PR #42', type: 'text' }] } },
        type: 'mcp_tool_call_end'
      },
      type: 'event_msg'
    }
  ])

  const tool = messages[1].tools[0]

  assert.equal(tool.kind, 'mcp')
  assert.equal(tool.name, 'github: search_pull_requests')
  assert.match(tool.output, /PR #42/)
})

test('codex: a <proposed_plan> block in the final message is lifted into turn.plan and stripped from text', () => {
  const { messages } = parseCodexTranscript([
    { payload: { message: 'go', type: 'user_message' }, type: 'event_msg' },
    { payload: { message: 'Sure thing.\n\n<proposed_plan>\nStep one.\nStep two.\n</proposed_plan>', type: 'agent_message' }, type: 'event_msg' }
  ])

  const turn = messages[1]

  assert.equal(turn.plan, 'Step one.\nStep two.')
  assert.equal(turn.text.includes('proposed_plan'), false)
  assert.equal(turn.text.trim(), 'Sure thing.')
})

// ── Store-level behaviors on a fake home ───────────────────────────────

function makeFakeStores() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-sessions-'))
  const claudeDir = path.join(root, '.claude')
  const codexDir = path.join(root, '.codex')
  const jarvisHome = path.join(root, '.jarvis')
  const projectDir = path.join(claudeDir, 'projects', '-tmp-proj')
  const claudeCwd = path.join(root, 'claude-proj')
  const codexCwd = path.join(root, 'codex-proj')

  fs.mkdirSync(projectDir, { recursive: true })
  fs.mkdirSync(path.join(codexDir, 'sessions', '2026', '07', '19'), { recursive: true })
  fs.mkdirSync(claudeCwd, { recursive: true })
  fs.mkdirSync(codexCwd, { recursive: true })

  const claudeSession = '11111111-2222-3333-4444-555555555555'

  fs.writeFileSync(
    path.join(projectDir, `${claudeSession}.jsonl`),
    [
      JSON.stringify(claudeUserLine('first prompt here', 'u1', claudeCwd)),
      JSON.stringify({ message: { content: [{ text: 'reply', type: 'text' }], role: 'assistant' }, type: 'assistant', uuid: 'a1' })
    ].join('\n')
  )

  const codexSession = '019f6eb1-f1b9-7ac2-978d-f7781669ee83'

  fs.writeFileSync(
    path.join(codexDir, 'sessions', '2026', '07', '19', `rollout-2026-07-19T02-09-43-${codexSession}.jsonl`),
    [
      JSON.stringify({ payload: { cwd: codexCwd, id: codexSession }, type: 'session_meta' }),
      JSON.stringify({ payload: { message: 'codex prompt', type: 'user_message' }, type: 'event_msg' })
    ].join('\n')
  )
  fs.writeFileSync(
    path.join(codexDir, 'session_index.jsonl'),
    JSON.stringify({ id: codexSession, thread_name: 'Indexed title', updated_at: '2026-07-19T02:10:00Z' })
  )

  return { claudeCwd, claudeDir, claudeSession, codexCwd, codexDir, codexSession, jarvisHome, root }
}

test('listSessions + readMessages across both providers', () => {
  const { claudeDir, claudeSession, codexDir, codexSession, jarvisHome } = makeFakeStores()
  const agents = createAgentSessions({ claudeDir, codexDir, jarvisHome })

  const claudeSessions = agents.listSessions('claude')

  assert.equal(claudeSessions.length, 1)
  assert.equal(claudeSessions[0].id, claudeSession)
  assert.equal(claudeSessions[0].title, 'first prompt here')
  assert.ok(claudeSessions[0].cwd.endsWith('claude-proj'))

  const codexSessions = agents.listSessions('codex')

  assert.equal(codexSessions.length, 1)
  assert.equal(codexSessions[0].id, codexSession)
  assert.equal(codexSessions[0].title, 'Indexed title')

  const transcript = agents.readMessages('claude', claudeSession)

  assert.equal(transcript.messages.length, 2)
  assert.equal(transcript.messages[1].text, 'reply')

  assert.equal(agents.readMessages('claude', 'missing-session').error, 'session_not_found')
  agents.dispose()
})

test('watch fires on file growth and unwatch stops it', async () => {
  const { claudeDir, claudeSession, codexDir, jarvisHome } = makeFakeStores()
  const agents = createAgentSessions({ claudeDir, codexDir, jarvisHome })

  const hits = []
  const unwatch = agents.watch('claude', claudeSession, payload => hits.push(payload))

  const filePath = path.join(claudeDir, 'projects', '-tmp-proj', `${claudeSession}.jsonl`)

  fs.appendFileSync(filePath, `\n${JSON.stringify(claudeUserLine('again', 'u9'))}`)

  await new Promise(resolve => setTimeout(resolve, 2500))
  assert.ok(hits.length >= 1)
  assert.equal(hits[0].session_id, claudeSession)

  unwatch()
  agents.dispose()
})

test('readClaudeAuthToken reads a stored token and is null when absent/malformed', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-auth-'))

  assert.equal(readClaudeAuthToken(root), null)

  fs.writeFileSync(path.join(root, 'agent-auth.json'), JSON.stringify({ claudeCodeOauthToken: 'sk-ant-oat01-fake' }))
  assert.equal(readClaudeAuthToken(root), 'sk-ant-oat01-fake')

  fs.writeFileSync(path.join(root, 'agent-auth.json'), 'not json')
  assert.equal(readClaudeAuthToken(root), null)

  fs.writeFileSync(path.join(root, 'agent-auth.json'), JSON.stringify({ claudeCodeOauthToken: '   ' }))
  assert.equal(readClaudeAuthToken(root), null)
})

// ── Live-process integration (fake claude-live-session / codex-appserver-client) ──
//
// The wire-protocol-level correctness of the persistent process managers
// themselves is covered by claude-live-session.test.cjs and
// codex-appserver-client.test.cjs — these tests exercise agent-sessions.cjs's
// own job: routing, workDir resolution, and live-turn/event merging, using
// controllable fakes of those two modules' public surface.

function makeFakeClaudeLive() {
  const calls = { configureLive: [], interrupt: [], sendMessage: [], steer: [] }
  const running = new Set()
  let eventHandler = null

  return {
    calls,
    configureLive: async (sessionId, opts) => {
      calls.configureLive.push({ sessionId, ...opts })

      return { applied: {}, deferred: false, pending: {} }
    },
    dispose: () => {},
    emit: (sessionId, message) => eventHandler?.({ message, sessionId }),
    hasLiveProcess: sessionId => running.has(sessionId),
    interrupt: async sessionId => {
      calls.interrupt.push(sessionId)

      return { ok: running.has(sessionId), reason: running.has(sessionId) ? undefined : 'not_running' }
    },
    isRunning: sessionId => running.has(sessionId),
    onEvent: handler => {
      eventHandler = handler

      return () => {
        eventHandler = null
      }
    },
    sendMessage: async (sessionId, opts) => {
      calls.sendMessage.push({ sessionId, ...opts })
      running.add(sessionId)
    },
    setRunning: (sessionId, value) => {
      if (value) running.add(sessionId)
      else running.delete(sessionId)
    },
    steer: async (sessionId, opts) => {
      calls.steer.push({ sessionId, ...opts })
    }
  }
}

function makeFakeCodexAppServer() {
  const calls = { compactThread: [], interruptTurn: [], resumeThread: [], rollbackThread: [], startThread: [], startTurn: [], steerTurn: [], updateThreadSettings: [] }
  const running = new Set()
  let notificationHandler = null
  let nextFreshId = 1

  return {
    calls,
    compactThread: async opts => {
      calls.compactThread.push(opts)

      return {}
    },
    dispose: () => {},
    emit: notification => notificationHandler?.(notification),
    interruptTurn: async ({ threadId }) => {
      calls.interruptTurn.push(threadId)

      const wasRunning = running.has(threadId)

      running.delete(threadId)

      return wasRunning ? { ok: true } : { ok: false, reason: 'not_running' }
    },
    isThreadRunning: threadId => running.has(threadId),
    onNotification: handler => {
      notificationHandler = handler

      return () => {
        notificationHandler = null
      }
    },
    resumeThread: async ({ cwd, threadId }) => {
      calls.resumeThread.push({ cwd, threadId })

      return { id: threadId, status: { type: 'idle' } }
    },
    rollbackThread: async opts => {
      calls.rollbackThread.push(opts)

      return {}
    },
    setRunning: (threadId, value) => {
      if (value) running.add(threadId)
      else running.delete(threadId)
    },
    startThread: async ({ cwd }) => {
      const id = `fresh-thread-${nextFreshId++}`

      calls.startThread.push({ cwd })

      return { id, status: { type: 'idle' } }
    },
    startTurn: async opts => {
      calls.startTurn.push(opts)
      running.add(opts.threadId)

      return { id: `turn-${opts.threadId}`, status: 'inProgress' }
    },
    steerTurn: async opts => {
      calls.steerTurn.push(opts)

      return { turnId: `turn-${opts.threadId}` }
    },
    updateThreadSettings: async opts => {
      calls.updateThreadSettings.push(opts)

      return {}
    }
  }
}

function makeIntegrationAgents(overrides = {}) {
  const { claudeDir, claudeSession, codexDir, codexSession, jarvisHome } = makeFakeStores()
  const claudeLive = makeFakeClaudeLive()
  const codexAppServer = makeFakeCodexAppServer()
  const agents = createAgentSessions({
    claudeDir,
    claudeLiveSessionImpl: claudeLive,
    codexAppServerImpl: codexAppServer,
    codexDir,
    jarvisHome,
    ...overrides
  })

  return { agents, claudeLive, claudeSession, codexAppServer, codexSession }
}

test('sendPrompt (claude): resumes an existing session and passes model/effort/planMode through', async () => {
  const { agents, claudeLive, claudeSession } = makeIntegrationAgents()
  const result = await agents.sendPrompt('claude', { effort: 'high', model: 'claude-opus-4-8', planMode: true, sessionId: claudeSession, text: 'go' })

  assert.equal(result.session_id, claudeSession)
  assert.ok(result.run_id)
  assert.equal(claudeLive.calls.sendMessage.length, 1)

  const call = claudeLive.calls.sendMessage[0]

  assert.equal(call.sessionId, claudeSession)
  assert.equal(call.effort, 'high')
  assert.equal(call.model, 'claude-opus-4-8')
  assert.equal(call.permissionMode, 'plan')
  assert.equal(call.text, 'go')
  assert.ok(call.cwd.endsWith('claude-proj'))
  agents.dispose()
})

test('sendPrompt (claude): a fresh session mints a uuid and returns it immediately', async () => {
  const { agents, claudeLive } = makeIntegrationAgents()
  const result = await agents.sendPrompt('claude', { cwd: '/tmp', text: 'fresh one' })

  assert.match(result.session_id, /^[0-9a-f-]{36}$/)
  assert.equal(claudeLive.calls.sendMessage[0].sessionId, result.session_id)
  assert.equal('permissionMode' in claudeLive.calls.sendMessage[0], false, 'an ordinary send must preserve a configured plan mode')
  agents.dispose()
})

test('sendPrompt (codex): starts a fresh thread when no sessionId given, resumes when one is', async () => {
  const { agents, codexAppServer, codexSession } = makeIntegrationAgents()

  const fresh = await agents.sendPrompt('codex', { cwd: '/tmp', text: 'new thread' })

  assert.equal(codexAppServer.calls.startThread.length, 1)
  assert.equal(fresh.session_id, codexAppServer.calls.startThread[0] && 'fresh-thread-1')
  assert.equal(codexAppServer.calls.startTurn[0].threadId, fresh.session_id)
  assert.equal(codexAppServer.calls.startTurn[0].text, 'new thread')

  const resumed = await agents.sendPrompt('codex', { model: 'gpt-5.6-sol', sessionId: codexSession, text: 'continue' })

  assert.equal(resumed.session_id, codexSession)
  assert.equal(codexAppServer.calls.resumeThread.length, 1)
  assert.equal(codexAppServer.calls.resumeThread[0].threadId, codexSession)
  assert.equal(codexAppServer.calls.startTurn[1].model, 'gpt-5.6-sol')
  agents.dispose()
})

test('sendPrompt validates provider and empty prompt before touching either module', async () => {
  const { agents, claudeLive, codexAppServer } = makeIntegrationAgents()

  assert.equal((await agents.sendPrompt('gemini', { text: 'x' })).error, 'unknown_provider')
  assert.equal((await agents.sendPrompt('claude', { text: '   ' })).error, 'empty_prompt')
  assert.equal(claudeLive.calls.sendMessage.length, 0)
  assert.equal(codexAppServer.calls.startThread.length, 0)
  agents.dispose()
})

test('steer routes to claudeLive.steer / codexAppServer.steerTurn, resuming the codex thread first', async () => {
  const { agents, claudeLive, claudeSession, codexAppServer, codexSession } = makeIntegrationAgents()

  const claudeResult = await agents.steer('claude', { sessionId: claudeSession, text: 'redirect' })

  assert.deepEqual(claudeResult, { ok: true })
  assert.equal(claudeLive.calls.steer[0].sessionId, claudeSession)
  assert.equal(claudeLive.calls.steer[0].text, 'redirect')

  const codexResult = await agents.steer('codex', { sessionId: codexSession, text: 'redirect codex' })

  assert.deepEqual(codexResult, { ok: true })
  assert.equal(codexAppServer.calls.resumeThread[0].threadId, codexSession)
  assert.equal(codexAppServer.calls.steerTurn[0].threadId, codexSession)
  assert.equal(codexAppServer.calls.steerTurn[0].text, 'redirect codex')

  assert.equal((await agents.steer('claude', { sessionId: claudeSession, text: '  ' })).error, 'empty_prompt')
  assert.equal((await agents.steer('claude', { text: 'no session' })).error, 'session_not_found')
  agents.dispose()
})

test('configure routes model/effort/planMode to the right module per provider', async () => {
  const { agents, claudeLive, claudeSession, codexAppServer, codexSession } = makeIntegrationAgents()

  await agents.configure('claude', { model: 'claude-sonnet-5', planMode: true, sessionId: claudeSession })
  assert.equal(claudeLive.calls.configureLive[0].sessionId, claudeSession)
  assert.equal(claudeLive.calls.configureLive[0].model, 'claude-sonnet-5')
  assert.equal(claudeLive.calls.configureLive[0].planMode, true)

  await agents.configure('codex', { effort: 'high', sessionId: codexSession })
  assert.equal(codexAppServer.calls.resumeThread.some(call => call.threadId === codexSession), true)
  assert.equal(codexAppServer.calls.updateThreadSettings[0].threadId, codexSession)
  assert.equal(codexAppServer.calls.updateThreadSettings[0].effort, 'high')

  assert.equal((await agents.configure('claude', {})).error, 'session_not_found')
  agents.dispose()
})

test('stop routes to claudeLive.interrupt / codexAppServer.interruptTurn', async () => {
  const { agents, claudeLive, claudeSession, codexAppServer, codexSession } = makeIntegrationAgents()

  claudeLive.setRunning(claudeSession, true)
  codexAppServer.setRunning(codexSession, true)

  assert.deepEqual(await agents.stop('claude', claudeSession), { ok: true, reason: undefined })
  assert.deepEqual(await agents.stop('codex', codexSession), { ok: true })
  assert.equal(claudeLive.calls.interrupt[0], claudeSession)
  assert.equal(codexAppServer.calls.interruptTurn[0], codexSession)
  agents.dispose()
})

test('runCommand sends confirmed Claude slash commands and maps Codex commands to app-server RPCs', async () => {
  const { agents, claudeLive, claudeSession, codexAppServer, codexSession } = makeIntegrationAgents()

  const claudeResult = await agents.runCommand('claude', { command: '/compact', sessionId: claudeSession })

  assert.equal(claudeResult.session_id, claudeSession)
  assert.equal(claudeLive.calls.sendMessage[0].text, '/compact')

  assert.deepEqual(await agents.runCommand('codex', { command: 'compact', sessionId: codexSession }), { ok: true })
  assert.deepEqual(codexAppServer.calls.compactThread[0], { threadId: codexSession })

  assert.deepEqual(await agents.runCommand('codex', { command: 'rollback', sessionId: codexSession }), { ok: true })
  assert.deepEqual(codexAppServer.calls.rollbackThread[0], { numTurns: 1, threadId: codexSession })
  assert.equal((await agents.runCommand('codex', { command: 'clear', sessionId: codexSession })).error, 'unknown_command')
  agents.dispose()
})

test('claude live events populate a live turn, merge into readMessages, and clear + fire run_done on result', async () => {
  const { agents, claudeLive, claudeSession } = makeIntegrationAgents()
  const runEvents = []

  agents.onRunEvent(event => runEvents.push(event))
  claudeLive.setRunning(claudeSession, true)

  claudeLive.emit(claudeSession, {
    event: { content_block: { id: 'tool-1', name: 'Bash', type: 'tool_use' }, type: 'content_block_start' },
    type: 'stream_event'
  })
  claudeLive.emit(claudeSession, {
    event: { delta: { partial_json: '{"command":"ls"}', type: 'input_json_delta' }, type: 'content_block_delta' },
    type: 'stream_event'
  })
  claudeLive.emit(claudeSession, { event: { type: 'content_block_stop' }, type: 'stream_event' })
  claudeLive.emit(claudeSession, {
    event: { delta: { text: 'Here you go', type: 'text_delta' }, type: 'content_block_delta' },
    type: 'stream_event'
  })

  const midTurn = agents.readMessages('claude', claudeSession)
  const liveMessage = midTurn.messages[midTurn.messages.length - 1]

  assert.equal(liveMessage.text, 'Here you go')
  assert.equal(liveMessage.tools[0].name, 'Bash')
  assert.equal(liveMessage.tools[0].detail, 'ls')
  assert.equal(midTurn.sending, true)
  assert.equal(runEvents.filter(event => event.type === 'agent.update').length > 0, true)

  claudeLive.setRunning(claudeSession, false)
  claudeLive.emit(claudeSession, { is_error: false, result: 'Here you go', subtype: 'success', type: 'result' })

  const afterTurn = agents.readMessages('claude', claudeSession)

  // The live accumulator is gone; only the two file-backed messages remain
  // (the in-progress turn never made it to disk in this test, which is
  // expected — it's the real CLI that flushes the transcript file).
  assert.equal(afterTurn.messages.length, 2)

  const done = runEvents.find(event => event.type === 'agent.run_done')

  assert.equal(done.ok, true)
  assert.equal(done.session_id, claudeSession)
  agents.dispose()
})

test('codex live notifications populate a live turn and clear on turn/completed', async () => {
  const { agents, codexAppServer, codexSession } = makeIntegrationAgents()
  const runEvents = []

  agents.onRunEvent(event => runEvents.push(event))

  codexAppServer.emit({ method: 'turn/started', params: { threadId: codexSession, turn: { id: 'turn-1' } } })
  codexAppServer.emit({
    method: 'item/completed',
    params: { item: { id: 'item-1', text: 'partial answer', type: 'agentMessage' }, threadId: codexSession, turnId: 'turn-1' }
  })

  const midTurn = agents.readMessages('codex', codexSession)
  const liveMessage = midTurn.messages[midTurn.messages.length - 1]

  assert.equal(liveMessage.text, 'partial answer')

  codexAppServer.emit({ method: 'turn/completed', params: { threadId: codexSession, turn: { id: 'turn-1', status: 'completed' } } })

  const afterTurn = agents.readMessages('codex', codexSession)

  assert.equal(afterTurn.messages.length, 1)

  const done = runEvents.find(event => event.type === 'agent.run_done')

  assert.equal(done.ok, true)
  assert.equal(done.session_id, codexSession)
  agents.dispose()
})

test('codex deltas expose reasoning, plan checklist, terminal output, real file diffs, and sub-agents live', () => {
  const { agents, codexAppServer, codexSession } = makeIntegrationAgents()

  codexAppServer.emit({ method: 'turn/started', params: { threadId: codexSession, turn: { id: 'turn-1' } } })
  codexAppServer.emit({ method: 'item/agentMessage/delta', params: { delta: 'Working', itemId: 'answer-1', threadId: codexSession, turnId: 'turn-1' } })
  codexAppServer.emit({ method: 'item/reasoning/summaryTextDelta', params: { delta: 'Checking the implementation', itemId: 'reason-1', summaryIndex: 0, threadId: codexSession, turnId: 'turn-1' } })
  codexAppServer.emit({
    method: 'turn/plan/updated',
    params: { plan: [{ status: 'in_progress', step: 'Inspect the bridge' }, { status: 'pending', step: 'Build it' }], threadId: codexSession, turnId: 'turn-1' }
  })
  codexAppServer.emit({
    method: 'item/started',
    params: { item: { aggregatedOutput: null, command: 'npm test', id: 'cmd-1', status: 'inProgress', type: 'commandExecution' }, threadId: codexSession, turnId: 'turn-1' }
  })
  codexAppServer.emit({ method: 'item/commandExecution/outputDelta', params: { delta: 'all tests pass\n', itemId: 'cmd-1', threadId: codexSession, turnId: 'turn-1' } })
  codexAppServer.emit({
    method: 'item/fileChange/patchUpdated',
    params: { changes: [{ diff: '@@ -1 +1 @@\n-old\n+new', kind: 'update', path: '/tmp/app.js' }], itemId: 'patch-1', threadId: codexSession, turnId: 'turn-1' }
  })
  codexAppServer.emit({ method: 'item/plan/delta', params: { delta: '# Full plan\nDo the work.', itemId: 'plan-1', threadId: codexSession, turnId: 'turn-1' } })
  codexAppServer.emit({
    method: 'item/started',
    params: { item: { agentPath: 'worker', agentThreadId: 'sub-1', id: 'agent-1', kind: 'spawned', type: 'subAgentActivity' }, threadId: codexSession, turnId: 'turn-1' }
  })

  const live = agents.readMessages('codex', codexSession).messages.at(-1)

  assert.equal(live.text, 'Working')
  assert.equal(live.thinking, 'Checking the implementation')
  assert.equal(live.plan, '# Full plan\nDo the work.')
  assert.deepEqual(live.checklist, [{ status: 'in_progress', step: 'Inspect the bridge' }, { status: 'pending', step: 'Build it' }])
  assert.equal(live.tools.find(tool => tool.id === 'cmd-1').command, 'npm test')
  assert.equal(live.tools.find(tool => tool.id === 'cmd-1').output, 'all tests pass\n')

  const diff = live.tools.find(tool => tool.id === 'patch-1:0')

  assert.equal(diff.kind, 'diff')
  assert.equal(diff.path, '/tmp/app.js')
  assert.match(diff.newText, /\+new/)
  assert.equal(live.tools.find(tool => tool.id === 'agent-1').kind, 'agent')
  assert.equal('_reasoningContent' in live, false)
  agents.dispose()
})

test('a failed codex turn reports ok:false with the error message on run_done', async () => {
  const { agents, codexAppServer, codexSession } = makeIntegrationAgents()
  const runEvents = []

  agents.onRunEvent(event => runEvents.push(event))
  codexAppServer.emit({ method: 'turn/started', params: { threadId: codexSession, turn: { id: 'turn-1' } } })
  codexAppServer.emit({
    method: 'turn/completed',
    params: { threadId: codexSession, turn: { error: { message: 'model rejected' }, id: 'turn-1', status: 'failed' } }
  })

  const done = runEvents.find(event => event.type === 'agent.run_done')

  assert.equal(done.ok, false)
  assert.equal(done.error, 'model rejected')
  agents.dispose()
})

// ── Real spawnEnv integration (unmocked claude-live-session/codex-appserver-client) ──
//
// These keep using a fake `spawnImpl` (not a fake module) so the REAL
// claude-live-session.cjs spawn path — including agent-sessions.cjs's own
// spawnEnv() with the long-lived-token injection — is exercised end to end.

function fakeChildProcess() {
  return {
    kill: () => {},
    on: () => {},
    stderr: { on: () => {} },
    stdin: { end: () => {}, write: () => {} },
    stdout: { on: () => {}, setEncoding: () => {} }
  }
}

test('sendPrompt injects the stored long-lived token as CLAUDE_CODE_OAUTH_TOKEN (real claude-live-session spawn path)', async () => {
  const { claudeDir, claudeSession, codexDir, jarvisHome } = makeFakeStores()

  fs.mkdirSync(jarvisHome, { recursive: true })
  fs.writeFileSync(path.join(jarvisHome, 'agent-auth.json'), JSON.stringify({ claudeCodeOauthToken: 'sk-ant-oat01-longlived' }))

  const spawned = []
  const fakeSpawn = (binary, args, options) => {
    spawned.push(options)

    return fakeChildProcess()
  }

  const agents = createAgentSessions({ claudeDir, codexDir, jarvisHome, spawnImpl: fakeSpawn })

  await agents.sendPrompt('claude', { sessionId: claudeSession, text: 'go' })
  assert.equal(spawned[0].env.CLAUDE_CODE_OAUTH_TOKEN, 'sk-ant-oat01-longlived')
  agents.dispose()
})

test('sendPrompt omits CLAUDE_CODE_OAUTH_TOKEN when no token file is stored (real claude-live-session spawn path)', async () => {
  const { claudeDir, claudeSession, codexDir, jarvisHome } = makeFakeStores()
  const inheritedToken = process.env.CLAUDE_CODE_OAUTH_TOKEN
  const spawned = []
  const fakeSpawn = (binary, args, options) => {
    spawned.push(options)

    return fakeChildProcess()
  }

  delete process.env.CLAUDE_CODE_OAUTH_TOKEN

  try {
    const agents = createAgentSessions({ claudeDir, codexDir, jarvisHome, spawnImpl: fakeSpawn })

    await agents.sendPrompt('claude', { sessionId: claudeSession, text: 'go' })
    assert.equal('CLAUDE_CODE_OAUTH_TOKEN' in spawned[0].env, false)
    agents.dispose()
  } finally {
    if (inheritedToken === undefined) {
      delete process.env.CLAUDE_CODE_OAUTH_TOKEN
    } else {
      process.env.CLAUDE_CODE_OAUTH_TOKEN = inheritedToken
    }
  }
})
