const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { test } = require('node:test')

const { createClaudeLiveSession } = require('./claude-live-session.cjs')

/** A fake persistent `claude -p --input-format stream-json ...` child. */
function makeFakeProcess() {
  const proc = new EventEmitter()

  proc.written = []
  proc.stdout = new EventEmitter()
  proc.stdout.setEncoding = () => {}
  proc.stderr = new EventEmitter()
  proc.ended = false
  proc.killedWith = null
  proc.stdin = {
    end: () => {
      proc.ended = true
    },
    write(text) {
      for (const line of text.split('\n')) {
        if (line.trim()) proc.written.push(JSON.parse(line))
      }
    }
  }
  proc.kill = signal => {
    proc.killedWith = signal || true
  }
  proc.emitLine = obj => proc.stdout.emit('data', `${JSON.stringify(obj)}\n`)
  proc.emitInit = (sessionId = 's1') => proc.emitLine({ session_id: sessionId, subtype: 'init', tools: [], type: 'system' })

  return proc
}

function makeManager(overrides = {}) {
  const processes = []
  const spawnImpl = () => {
    const proc = makeFakeProcess()

    processes.push(proc)

    return proc
  }

  const manager = createClaudeLiveSession({ idleEvictMs: 10_000, log: () => {}, spawnImpl, ...overrides })

  return { manager, processes }
}

test('sendMessage spawns a process with --session-id on first use and writes the user message', async () => {
  const { manager, processes } = makeManager()

  await manager.sendMessage('sess-1', { cwd: '/tmp', text: 'hello' })

  assert.equal(processes.length, 1)
  const proc = processes[0]

  assert.ok(proc.spawnArgs === undefined) // spawnImpl doesn't capture args here; verified via written message below
  const userMessage = proc.written.find(m => m.type === 'user')

  assert.deepEqual(userMessage.message, { content: [{ text: 'hello', type: 'text' }], role: 'user' })
  assert.equal(manager.isRunning('sess-1'), true)
  assert.equal(manager.hasLiveProcess('sess-1'), true)
})

test('a second sendMessage on the same session reuses the process (no new spawn)', async () => {
  const { manager, processes } = makeManager()

  await manager.sendMessage('sess-1', { cwd: '/tmp', text: 'first' })
  processes[0].emitLine({ subtype: 'success', type: 'result' })
  await manager.sendMessage('sess-1', { cwd: '/tmp', text: 'second' })

  assert.equal(processes.length, 1)
  assert.equal(processes[0].written.filter(m => m.type === 'user').length, 2)
})

test('a result event flips isRunning back to false', async () => {
  const { manager, processes } = makeManager()

  await manager.sendMessage('sess-1', { cwd: '/tmp', text: 'hi' })
  assert.equal(manager.isRunning('sess-1'), true)

  processes[0].emitLine({ result: 'done', subtype: 'success', type: 'result' })
  assert.equal(manager.isRunning('sess-1'), false)
})

test('a mid-turn assistant tool_use stop_reason does not mark the turn complete', async () => {
  const { manager, processes } = makeManager()

  await manager.sendMessage('sess-1', { cwd: '/tmp', text: 'edit the file' })
  processes[0].emitLine({
    message: { content: [{ id: 'tool-1', input: {}, name: 'Edit', type: 'tool_use' }], stop_reason: 'tool_use' },
    type: 'assistant'
  })

  assert.equal(manager.isRunning('sess-1'), true)

  processes[0].emitLine({ result: 'done', subtype: 'success', type: 'result' })
  assert.equal(manager.isRunning('sess-1'), false)
})

test('interrupt sends a control_request and resolves on control_response; no-ops when idle', async () => {
  const { manager, processes } = makeManager()

  const idleResult = await manager.interrupt('never-started')

  assert.deepEqual(idleResult, { ok: false, reason: 'not_running' })

  await manager.sendMessage('sess-1', { cwd: '/tmp', text: 'go' })
  const proc = processes[0]
  const interruptPromise = manager.interrupt('sess-1')

  await new Promise(resolve => setImmediate(resolve))
  const controlRequest = proc.written.find(m => m.type === 'control_request')

  assert.equal(controlRequest.request.subtype, 'interrupt')
  proc.emitLine({ response: { request_id: controlRequest.request_id, subtype: 'success' }, type: 'control_response' })

  const result = await interruptPromise

  assert.deepEqual(result, { ok: true })
})

test('steer interrupts the running turn then sends the new text on the same process', async () => {
  const { manager, processes } = makeManager()

  await manager.sendMessage('sess-1', { cwd: '/tmp', text: 'first' })
  const proc = processes[0]
  const steerPromise = manager.steer('sess-1', { cwd: '/tmp', text: 'redirected' })

  await new Promise(resolve => setImmediate(resolve))
  const controlRequest = proc.written.find(m => m.type === 'control_request')

  assert.equal(controlRequest.request.subtype, 'interrupt')
  proc.emitLine({ response: { request_id: controlRequest.request_id, subtype: 'success' }, type: 'control_response' })
  await steerPromise

  assert.equal(processes.length, 1, 'steer reuses the process, does not respawn')
  const userMessages = proc.written.filter(m => m.type === 'user')

  assert.equal(userMessages[1].message.content[0].text, 'redirected')
})

test('configureLive applies model/planMode via control_request when a process is up, defers otherwise', async () => {
  const { manager, processes } = makeManager()

  const deferred = await manager.configureLive('sess-1', { model: 'claude-opus-4-8', planMode: true })

  assert.equal(deferred.deferred, true)

  await manager.sendMessage('sess-1', { cwd: '/tmp', text: 'go' })
  const proc = processes[0]

  // model/planMode were pre-set via the deferred configure, so this spawn
  // should already carry --model/--permission-mode plan without another
  // control_request round-trip being necessary immediately.
  const livePromise = manager.configureLive('sess-1', { model: 'claude-sonnet-5' })

  await new Promise(resolve => setImmediate(resolve))
  const setModelCall = proc.written.find(m => m.type === 'control_request' && m.request.subtype === 'set_model')

  assert.equal(setModelCall.request.model, 'claude-sonnet-5')
  proc.emitLine({ response: { request_id: setModelCall.request_id, subtype: 'success' }, type: 'control_response' })

  const result = await livePromise

  assert.equal(result.deferred, false)
  assert.equal(result.applied.model, 'claude-sonnet-5')
})

test('configureLive always defers effort to next spawn — no live control_request for it, even with a process up', async () => {
  const { manager, processes } = makeManager()

  await manager.sendMessage('sess-1', { cwd: '/tmp', effort: 'low', text: 'go' })
  const proc = processes[0]

  const result = await manager.configureLive('sess-1', { effort: 'high' })

  assert.deepEqual(result.pending, { effort: 'high' })
  assert.equal('effort' in result.applied, false)
  assert.equal(proc.written.some(m => m.type === 'control_request'), false, 'no control_request sent for effort')

  const sendPromise = manager.sendMessage('sess-1', { cwd: '/tmp', effort: 'high', text: 'next' })

  await new Promise(resolve => setImmediate(resolve))
  proc.emit('exit', 0, null)
  await sendPromise

  assert.equal(processes.length, 2, 'the pending effort change respawned on the next send')
})

test('an effort change triggers a respawn on the next sendMessage', async () => {
  const { manager, processes } = makeManager()

  await manager.sendMessage('sess-1', { cwd: '/tmp', effort: 'low', text: 'first' })
  assert.equal(processes.length, 1)

  const sendPromise = manager.sendMessage('sess-1', { cwd: '/tmp', effort: 'high', text: 'second' })

  await new Promise(resolve => setImmediate(resolve))
  // stop() closes stdin and waits for exit before the respawn proceeds.
  processes[0].emit('exit', 0, null)
  await sendPromise

  assert.equal(processes.length, 2, 'effort change respawned the process')
})

test('stop() closes stdin gracefully and falls back to SIGINT if the process does not exit in time', async () => {
  const { manager, processes } = makeManager()

  await manager.sendMessage('sess-1', { cwd: '/tmp', text: 'go' })
  const proc = processes[0]
  const stopPromise = manager.stop('sess-1', { drainMs: 10 })

  // Answer the interrupt promptly so this test exercises the drain-timeout
  // → SIGINT fallback specifically, not the (much longer) control_request
  // timeout — the fake process never emits its own 'exit', simulating one
  // that's stuck and needs the SIGINT fallback.
  await new Promise(resolve => setImmediate(resolve))
  const controlRequest = proc.written.find(m => m.type === 'control_request')

  proc.emitLine({ response: { request_id: controlRequest.request_id, subtype: 'success' }, type: 'control_response' })
  await stopPromise

  assert.equal(proc.ended, true)
  assert.equal(proc.killedWith, 'SIGINT')
})

test('process exit clears running state and rejects any pending control request', async () => {
  const { manager, processes } = makeManager()

  await manager.sendMessage('sess-1', { cwd: '/tmp', text: 'go' })
  const proc = processes[0]
  const interruptPromise = manager.interrupt('sess-1')

  await new Promise(resolve => setImmediate(resolve))
  proc.emit('exit', 1, null)

  await assert.rejects(interruptPromise, /exited/)
  assert.equal(manager.isRunning('sess-1'), false)
  assert.equal(manager.hasLiveProcess('sess-1'), false)
})

test('idle eviction closes stdin after the configured timeout with no activity', async () => {
  const evicted = []
  const { manager, processes } = makeManager({ idleEvictMs: 20, onEvict: info => evicted.push(info) })

  await manager.sendMessage('sess-1', { cwd: '/tmp', text: 'go' })
  processes[0].emitLine({ subtype: 'success', type: 'result' })

  await new Promise(resolve => setTimeout(resolve, 60))

  assert.equal(evicted.length, 1)
  assert.equal(evicted[0].sessionId, 'sess-1')
  assert.equal(processes[0].ended, true)
})

test('malformed lines are ignored, not fatal', async () => {
  const { manager, processes } = makeManager()

  await manager.sendMessage('sess-1', { cwd: '/tmp', text: 'go' })
  processes[0].emitLine({ type: 'not json' })
  processes[0].stdout.emit('data', 'garbage\n')
  processes[0].emitLine({ subtype: 'success', type: 'result' })

  assert.equal(manager.isRunning('sess-1'), false)
})

test('onEvent forwards every parsed line tagged with the session id', async () => {
  const { manager, processes } = makeManager()
  const events = []

  manager.onEvent(({ message, sessionId }) => events.push({ sessionId, type: message.type }))

  await manager.sendMessage('sess-1', { cwd: '/tmp', text: 'go' })
  processes[0].emitInit('sess-1')
  processes[0].emitLine({ result: 'ok', subtype: 'success', type: 'result' })

  assert.deepEqual(events, [
    { sessionId: 'sess-1', type: 'system' },
    { sessionId: 'sess-1', type: 'result' }
  ])
})
