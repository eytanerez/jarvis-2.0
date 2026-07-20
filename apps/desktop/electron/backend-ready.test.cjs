const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const test = require('node:test')

const {
  DEFAULT_DASHBOARD_PORT_TIMEOUT_MS,
  terminateChild,
  waitForDashboardPort
} = require('./backend-ready.cjs')

function fakeChild() {
  const child = new EventEmitter()
  child.stdout = new EventEmitter()
  child.exitCode = null
  child.signalCode = null
  child.killed = false
  child.killSignal = null
  child.kill = signal => {
    child.killed = true
    child.killSignal = signal
  }
  return child
}

test('waitForDashboardPort parses a fragmented ready line', async () => {
  const child = fakeChild()
  const promise = waitForDashboardPort(child, 1000)

  child.stdout.emit('data', 'noise\nJARVIS_DASHBOARD_READY ')
  child.stdout.emit('data', 'port=49231\n')

  assert.equal(await promise, 49231)
  assert.equal(child.killed, false)
})

test('waitForDashboardPort terminates the backend child on timeout', async () => {
  const child = fakeChild()

  await assert.rejects(
    waitForDashboardPort(child, 5),
    /Timed out waiting for Jarvis backend port announcement \(5ms\)/
  )
  assert.equal(child.killed, true)
  assert.equal(child.killSignal, 'SIGTERM')
})

test('terminateChild ignores already-finished children', () => {
  const child = fakeChild()
  child.exitCode = 0

  terminateChild(child)

  assert.equal(child.killed, false)
  assert.equal(DEFAULT_DASHBOARD_PORT_TIMEOUT_MS, 120_000)
})
