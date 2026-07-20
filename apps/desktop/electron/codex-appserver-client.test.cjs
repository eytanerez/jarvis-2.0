const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { test } = require('node:test')

const { createCodexAppServer } = require('./codex-appserver-client.cjs')

/** A fake `codex app-server` child: captures outgoing NDJSON lines, lets
 * tests push response/notification lines back on stdout. */
function makeFakeProcess() {
  const proc = new EventEmitter()

  proc.written = []
  proc.stdout = new EventEmitter()
  proc.stdout.setEncoding = () => {}
  proc.stderr = new EventEmitter()
  proc.killed = false
  proc.stdin = {
    write(text) {
      for (const line of text.split('\n')) {
        if (line.trim()) proc.written.push(JSON.parse(line))
      }
    }
  }
  proc.kill = signal => {
    proc.killed = signal || true
  }
  proc.emitLine = obj => proc.stdout.emit('data', `${JSON.stringify(obj)}\n`)
  proc.emitRaw = text => proc.stdout.emit('data', text)

  return proc
}

/** Auto-answers `initialize` + `initialized` on the given fake process the
 * moment they're sent, so tests can focus on the RPC under test. */
function autoInitialize(proc) {
  const originalWrite = proc.stdin.write

  proc.stdin.write = text => {
    originalWrite(text)

    for (const line of text.split('\n')) {
      if (!line.trim()) continue

      const message = JSON.parse(line)

      if (message.method === 'initialize') {
        queueMicrotask(() => proc.emitLine({ id: message.id, result: { codexHome: '/tmp', platformFamily: 'unix', platformOs: 'macos', userAgent: 'test' } }))
      }
    }
  }
}

function makeClient(overrides = {}) {
  const processes = []
  const spawnImpl = () => {
    const proc = makeFakeProcess()

    autoInitialize(proc)
    processes.push(proc)

    return proc
  }

  const client = createCodexAppServer({ log: () => {}, spawnImpl, ...overrides })

  return { client, processes }
}

test('startThread sends thread/start after a transparent initialize handshake', async () => {
  const { client, processes } = makeClient()

  const startPromise = client.startThread({ cwd: '/tmp/proj' })

  await new Promise(resolve => setImmediate(resolve))
  const proc = processes[0]
  const threadStartCall = proc.written.find(message => message.method === 'thread/start')

  assert.ok(threadStartCall)
  assert.deepEqual(threadStartCall.params, { approvalPolicy: 'never', cwd: '/tmp/proj', sandbox: 'workspace-write' })

  proc.emitLine({ id: threadStartCall.id, result: { model: 'gpt-5.2', reasoningEffort: 'medium', thread: { id: 't1', status: { type: 'idle' } } } })

  const thread = await startPromise

  assert.equal(thread.id, 't1')

  // initialize happened exactly once, before thread/start.
  const methods = proc.written.map(m => m.method)

  assert.deepEqual(methods.slice(0, 2), ['initialize', 'initialized'])
  client.dispose()
})

test('startTurn sets running/turnId from the response; turn/completed notification clears it', async () => {
  const { client, processes } = makeClient()
  const turnPromise = client.startTurn({ effort: 'low', text: 'hello', threadId: 't1' })

  await new Promise(resolve => setImmediate(resolve))
  const proc = processes[0]
  const turnStart = proc.written.find(m => m.method === 'turn/start')

  assert.deepEqual(turnStart.params, { effort: 'low', input: [{ text: 'hello', type: 'text' }], threadId: 't1' })

  proc.emitLine({ id: turnStart.id, result: { turn: { id: 'turn1', status: 'inProgress' } } })
  await turnPromise

  assert.equal(client.isThreadRunning('t1'), true)

  proc.emitLine({ method: 'turn/completed', params: { threadId: 't1', turn: { id: 'turn1', status: 'completed' } } })
  await new Promise(resolve => setImmediate(resolve))

  assert.equal(client.isThreadRunning('t1'), false)
  client.dispose()
})

test('planMode true/false/omitted map to schema-complete collaborationMode on turn/start', async () => {
  const { client, processes } = makeClient()

  client.startTurn({ effort: 'low', model: 'gpt-5.2', planMode: true, text: 'go', threadId: 't1' })
  await new Promise(resolve => setImmediate(resolve))
  let call = processes[0].written.find(m => m.method === 'turn/start')

  assert.deepEqual(call.params.collaborationMode, {
    mode: 'plan',
    settings: { model: 'gpt-5.2', reasoning_effort: 'low' }
  })
  processes[0].emitLine({ id: call.id, result: { turn: { id: 'turn1' } } })
  await new Promise(resolve => setImmediate(resolve))

  client.startTurn({ planMode: false, text: 'go again', threadId: 't1' })
  await new Promise(resolve => setImmediate(resolve))
  call = processes[0].written.filter(m => m.method === 'turn/start')[1]
  assert.deepEqual(call.params.collaborationMode, {
    mode: 'default',
    settings: { model: 'gpt-5.2', reasoning_effort: 'low' }
  })
  processes[0].emitLine({ id: call.id, result: { turn: { id: 'turn2' } } })
  await new Promise(resolve => setImmediate(resolve))

  client.startTurn({ text: 'plain', threadId: 't1' })
  await new Promise(resolve => setImmediate(resolve))
  call = processes[0].written.filter(m => m.method === 'turn/start')[2]
  assert.equal('collaborationMode' in call.params, false)

  client.dispose()
})

test('planMode fails clearly when no thread or explicit model is known', async () => {
  const { client } = makeClient()

  await assert.rejects(
    () => client.startTurn({ planMode: true, text: 'go', threadId: 'unknown' }),
    /thread model is known/
  )
  client.dispose()
})

test('steerTurn requires an active turn and sends expectedTurnId', async () => {
  const { client, processes } = makeClient()

  await assert.rejects(() => client.steerTurn({ text: 'redirect', threadId: 't1' }), /not_running|no active turn/)

  const turnPromise = client.startTurn({ text: 'go', threadId: 't1' })

  await new Promise(resolve => setImmediate(resolve))
  const proc = processes[0]
  const turnStart = proc.written.find(m => m.method === 'turn/start')

  proc.emitLine({ id: turnStart.id, result: { turn: { id: 'turn1' } } })
  await turnPromise

  const steerPromise = client.steerTurn({ text: 'redirect', threadId: 't1' })

  await new Promise(resolve => setImmediate(resolve))
  const steerCall = proc.written.find(m => m.method === 'turn/steer')

  assert.deepEqual(steerCall.params, { expectedTurnId: 'turn1', input: [{ text: 'redirect', type: 'text' }], threadId: 't1' })
  proc.emitLine({ id: steerCall.id, result: { turnId: 'turn1' } })
  await steerPromise
  client.dispose()
})

test('interruptTurn no-ops when idle and calls turn/interrupt when running', async () => {
  const { client, processes } = makeClient()

  const idleResult = await client.interruptTurn({ threadId: 'never-started' })

  assert.deepEqual(idleResult, { ok: false, reason: 'not_running' })

  const turnPromise = client.startTurn({ text: 'go', threadId: 't1' })

  await new Promise(resolve => setImmediate(resolve))
  const proc = processes[0]
  const turnStart = proc.written.find(m => m.method === 'turn/start')

  proc.emitLine({ id: turnStart.id, result: { turn: { id: 'turn1' } } })
  await turnPromise

  const interruptPromise = client.interruptTurn({ threadId: 't1' })

  await new Promise(resolve => setImmediate(resolve))
  const interruptCall = proc.written.find(m => m.method === 'turn/interrupt')

  assert.deepEqual(interruptCall.params, { threadId: 't1', turnId: 'turn1' })
  proc.emitLine({ id: interruptCall.id, result: {} })

  const result = await interruptPromise

  assert.deepEqual(result, { ok: true })
  client.dispose()
})

test('updateThreadSettings sends only the provided overrides', async () => {
  const { client, processes } = makeClient()
  const settingsPromise = client.updateThreadSettings({ effort: 'high', model: 'gpt-5.6-sol', threadId: 't1' })

  await new Promise(resolve => setImmediate(resolve))
  const proc = processes[0]
  const call = proc.written.find(m => m.method === 'thread/settings/update')

  assert.deepEqual(call.params, { effort: 'high', model: 'gpt-5.6-sol', threadId: 't1' })
  proc.emitLine({ id: call.id, result: {} })
  await settingsPromise
  client.dispose()
})

test('updateThreadSettings accepts null resets and builds plan mode from the resumed model', async () => {
  const { client, processes } = makeClient()
  const resumePromise = client.resumeThread({ threadId: 't1' })

  await new Promise(resolve => setImmediate(resolve))
  const proc = processes[0]
  const resumeCall = proc.written.find(m => m.method === 'thread/resume')

  proc.emitLine({ id: resumeCall.id, result: { model: 'gpt-5.2', reasoningEffort: 'medium', thread: { id: 't1' } } })
  await resumePromise

  const settingsPromise = client.updateThreadSettings({ effort: null, model: null, planMode: true, threadId: 't1' })

  await new Promise(resolve => setImmediate(resolve))
  const settingsCall = proc.written.find(m => m.method === 'thread/settings/update')

  assert.deepEqual(settingsCall.params, {
    collaborationMode: { mode: 'plan', settings: { model: 'gpt-5.2', reasoning_effort: null } },
    effort: null,
    model: null,
    threadId: 't1'
  })
  proc.emitLine({ id: settingsCall.id, result: {} })
  await settingsPromise
  client.dispose()
})

test('compactThread and rollbackThread map to the provider-native RPCs', async () => {
  const { client, processes } = makeClient()
  const compactPromise = client.compactThread({ threadId: 't1' })

  await new Promise(resolve => setImmediate(resolve))
  const proc = processes[0]
  const compactCall = proc.written.find(m => m.method === 'thread/compact/start')

  assert.deepEqual(compactCall.params, { threadId: 't1' })
  proc.emitLine({ id: compactCall.id, result: {} })
  await compactPromise

  const rollbackPromise = client.rollbackThread({ threadId: 't1' })

  await new Promise(resolve => setImmediate(resolve))
  const rollbackCall = proc.written.find(m => m.method === 'thread/rollback')

  assert.deepEqual(rollbackCall.params, { numTurns: 1, threadId: 't1' })
  proc.emitLine({ id: rollbackCall.id, result: { thread: { id: 't1' } } })
  await rollbackPromise
  client.dispose()
})

test('an error response rejects the caller with the code/message intact', async () => {
  const { client, processes } = makeClient()
  const callPromise = client.call('collaborationMode/list', {})

  await new Promise(resolve => setImmediate(resolve))
  const proc = processes[0]
  const listCall = proc.written.find(m => m.method === 'collaborationMode/list')

  proc.emitLine({ error: { code: -32600, message: 'collaborationMode/list requires experimentalApi capability' }, id: listCall.id })

  await assert.rejects(callPromise, error => {
    assert.equal(error.code, -32600)
    assert.match(error.message, /experimentalApi/)

    return true
  })
  client.dispose()
})

test('malformed lines are ignored, not fatal', async () => {
  const { client, processes } = makeClient()
  const startPromise = client.startThread({ cwd: '/tmp' })

  await new Promise(resolve => setImmediate(resolve))
  const proc = processes[0]

  proc.emitRaw('not json at all\n')
  proc.emitRaw('{"partial":\n')
  const call = proc.written.find(m => m.method === 'thread/start')

  proc.emitLine({ id: call.id, result: { thread: { id: 't1' } } })

  const thread = await startPromise

  assert.equal(thread.id, 't1')
  client.dispose()
})

test('process exit rejects pending calls and clears running state', async () => {
  const { client, processes } = makeClient()
  const turnPromise = client.startTurn({ text: 'go', threadId: 't1' })

  await new Promise(resolve => setImmediate(resolve))
  const proc = processes[0]
  const turnStart = proc.written.find(m => m.method === 'turn/start')

  proc.emitLine({ id: turnStart.id, result: { turn: { id: 'turn1' } } })
  await turnPromise
  assert.equal(client.isThreadRunning('t1'), true)

  const stuckCall = client.call('turn/steer', { threadId: 't1' })

  // Let the call actually register in the pending map before the process
  // dies — otherwise `call()` never gets past its own `ensureStarted()`
  // await and just throws "not running" instead of being rejected by exit.
  await new Promise(resolve => setImmediate(resolve))
  proc.emit('exit', 1, null)

  await assert.rejects(stuckCall, /exited/)
  assert.equal(client.isThreadRunning('t1'), false)
  assert.equal(client.isRunning(), false)
  client.dispose()
})

test('a fresh process is spawned again after exit (auto-respawn on next call)', async () => {
  const { client, processes } = makeClient()

  const firstPromise = client.startThread({ cwd: '/tmp' })

  await new Promise(resolve => setImmediate(resolve))
  const first = processes[0]
  const firstCall = first.written.find(m => m.method === 'thread/start')

  first.emitLine({ id: firstCall.id, result: { thread: { id: 't1' } } })
  await firstPromise

  first.emit('exit', 0, null)
  await new Promise(resolve => setImmediate(resolve))

  const secondPromise = client.startThread({ cwd: '/tmp' })

  await new Promise(resolve => setImmediate(resolve))
  assert.equal(processes.length, 2)

  const second = processes[1]
  const secondCall = second.written.find(m => m.method === 'thread/start')

  second.emitLine({ id: secondCall.id, result: { thread: { id: 't2' } } })

  const thread = await secondPromise

  assert.equal(thread.id, 't2')
  client.dispose()
})

test('call() times out if no response ever arrives', async () => {
  const { client } = makeClient()

  await assert.rejects(client.call('turn/interrupt', { threadId: 't1' }, 20), /timed out/)
  client.dispose()
})
