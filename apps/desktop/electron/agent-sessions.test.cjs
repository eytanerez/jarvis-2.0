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

// ── Store-level behaviors on a fake home ───────────────────────────────

function makeFakeStores() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-sessions-'))
  const claudeDir = path.join(root, '.claude')
  const codexDir = path.join(root, '.codex')
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

  return { claudeCwd, claudeDir, claudeSession, codexCwd, codexDir, codexSession, root }
}

test('listSessions + readMessages across both providers', () => {
  const { claudeDir, claudeSession, codexDir, codexSession } = makeFakeStores()
  const agents = createAgentSessions({ claudeDir, codexDir })

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

test('sendPrompt spawns the right CLI shapes and reports run lifecycle', async () => {
  const { claudeCwd, claudeDir, claudeSession, codexCwd, codexDir, codexSession } = makeFakeStores()
  const spawned = []

  const fakeSpawn = (binary, args, options) => {
    const listeners = {}
    const child = {
      kill: () => {},
      on: (name, callback) => {
        listeners[name] = callback
      },
      stderr: { on: () => {} },
      stdin: { end: () => {}, write: () => {} },
      stdout: { on: () => {} }
    }

    spawned.push({ args, binary, exit: code => listeners.exit?.(code), options })

    return child
  }

  const agents = createAgentSessions({ claudeDir, codexDir, spawnImpl: fakeSpawn })
  const events = []

  agents.onRunEvent(event => events.push(event))

  const claudeResult = agents.sendPrompt('claude', { sessionId: claudeSession, text: 'do more' })

  assert.ok(claudeResult.run_id)
  assert.equal(claudeResult.session_id, claudeSession)
  assert.deepEqual(spawned[0].args.slice(0, 3), ['-p', '--resume', claudeSession])
  assert.equal(spawned[0].options.cwd, claudeCwd)

  const codexResult = agents.sendPrompt('codex', { sessionId: codexSession, text: 'continue' })

  assert.equal(codexResult.session_id, codexSession)
  assert.equal(spawned[1].args[0], 'exec')
  assert.equal(spawned[1].args[1], 'resume')
  assert.equal(spawned[1].args[2], codexSession)
  assert.equal(spawned[1].options.cwd, codexCwd)

  assert.equal(agents.runningRuns().length, 2)
  spawned[0].exit(0)
  spawned[1].exit(1)
  assert.equal(agents.runningRuns().length, 0)

  const done = events.filter(event => event.type === 'agent.run_done')

  assert.equal(done.length, 2)
  assert.equal(done[0].ok, true)
  assert.equal(done[1].ok, false)

  assert.equal(agents.sendPrompt('claude', { sessionId: claudeSession, text: '  ' }).error, 'empty_prompt')
  assert.equal(agents.sendPrompt('claude', { sessionId: 'missing', text: 'x' }).error, 'session_not_found')
  agents.dispose()
})

test('sendPrompt inserts --model only when a model is given, for both providers and fresh/resumed sessions', () => {
  const { claudeDir, claudeSession, codexDir, codexSession } = makeFakeStores()
  const spawned = []

  const fakeSpawn = (binary, args) => {
    spawned.push(args)

    return {
      kill: () => {},
      on: () => {},
      stderr: { on: () => {} },
      stdin: { end: () => {}, write: () => {} },
      stdout: { on: () => {} }
    }
  }

  const agents = createAgentSessions({ claudeDir, codexDir, spawnImpl: fakeSpawn })

  agents.sendPrompt('claude', { model: 'claude-opus-4-8', sessionId: claudeSession, text: 'go' })
  assert.ok(spawned[0].includes('--model'))
  assert.equal(spawned[0][spawned[0].indexOf('--model') + 1], 'claude-opus-4-8')

  agents.sendPrompt('claude', { cwd: '/tmp', text: 'fresh' })
  assert.equal(spawned[1].includes('--model'), false)

  agents.sendPrompt('codex', { model: 'gpt-5.6-sol', sessionId: codexSession, text: 'go' })
  assert.ok(spawned[2].includes('--model'))
  assert.equal(spawned[2][spawned[2].indexOf('--model') + 1], 'gpt-5.6-sol')
  // --model must land before the `--` separator, not after the prompt.
  assert.ok(spawned[2].indexOf('--model') < spawned[2].indexOf('--'))

  agents.sendPrompt('codex', { cwd: '/tmp', text: 'fresh codex' })
  assert.equal(spawned[3].includes('--model'), false)

  agents.dispose()
})

test('new claude session gets a fresh uuid; new codex session resolves id from stdout', () => {
  const { claudeDir, codexDir } = makeFakeStores()
  const spawned = []

  const fakeSpawn = (binary, args, options) => {
    const listeners = { stdout: null }
    const child = {
      kill: () => {},
      on: () => {},
      stderr: { on: () => {} },
      stdin: { end: () => {}, write: () => {} },
      stdout: {
        on: (name, callback) => {
          if (name === 'data') listeners.stdout = callback
        }
      }
    }

    spawned.push({ args, binary, emitStdout: text => listeners.stdout?.(text), options })

    return child
  }

  const agents = createAgentSessions({ claudeDir, codexDir, spawnImpl: fakeSpawn })
  const events = []

  agents.onRunEvent(event => events.push(event))

  const claudeResult = agents.sendPrompt('claude', { cwd: '/tmp', text: 'fresh one' })

  assert.match(claudeResult.session_id, /^[0-9a-f-]{36}$/)
  assert.ok(spawned[0].args.includes('--session-id'))

  const codexResult = agents.sendPrompt('codex', { cwd: '/tmp', text: 'fresh codex' })

  assert.equal(codexResult.session_id, null)
  spawned[1].emitStdout(`${JSON.stringify({ thread_id: '019f6eb1-aaaa-7ac2-978d-f7781669ee83', type: 'thread.started' })}\n`)

  const resolved = events.find(event => event.type === 'agent.session_resolved')

  assert.ok(resolved)
  assert.equal(resolved.session_id, '019f6eb1-aaaa-7ac2-978d-f7781669ee83')
  agents.dispose()
})

test('watch fires on file growth and unwatch stops it', async () => {
  const { claudeDir, claudeSession, codexDir } = makeFakeStores()
  const agents = createAgentSessions({ claudeDir, codexDir })

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
