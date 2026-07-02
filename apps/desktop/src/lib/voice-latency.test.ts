import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  beginVoiceLatencyTurn,
  cancelVoiceLatencyTurn,
  endVoiceLatencyTurn,
  markVoiceLatency
} from './voice-latency'

describe('voice-latency', () => {
  afterEach(() => {
    cancelVoiceLatencyTurn()
    vi.restoreAllMocks()
  })

  it('marks are no-ops before a turn is opened', () => {
    expect(markVoiceLatency('transcript-received')).toBeNull()
    expect(endVoiceLatencyTurn('first-audio')).toBeNull()
  })

  it('backdates t0 by the confirm window', () => {
    beginVoiceLatencyTurn(1_000)

    // Immediately after opening, the elapsed time already includes the
    // trailing-silence window the user sat through before end-of-turn fired.
    const seconds = markVoiceLatency('recorder-stopped')

    expect(seconds).not.toBeNull()
    expect(seconds!).toBeGreaterThanOrEqual(1)
    expect(seconds!).toBeLessThan(2)
  })

  it('treats a negative confirm window as zero', () => {
    beginVoiceLatencyTurn(-500)

    const seconds = markVoiceLatency('recorder-stopped')

    expect(seconds).not.toBeNull()
    expect(seconds!).toBeGreaterThanOrEqual(0)
    expect(seconds!).toBeLessThan(0.5)
  })

  it('end closes the turn so later marks are no-ops', () => {
    beginVoiceLatencyTurn(0)

    expect(endVoiceLatencyTurn('first-audio')).not.toBeNull()
    // Later chunks of the same reply must not log against a stale t0.
    expect(markVoiceLatency('tts-audio-received')).toBeNull()
  })

  it('end logs a full stage breakdown with the dominant gap', () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {})

    beginVoiceLatencyTurn(600)
    markVoiceLatency('recorder-stopped')
    markVoiceLatency('transcript-received')
    markVoiceLatency('first-response-text')
    endVoiceLatencyTurn('first-audio')

    const breakdown = debug.mock.calls.find(call => String(call[0]).includes('[voice-latency] breakdown'))

    expect(breakdown?.[0]).toContain('stop-talking->recorder-stopped')
    expect(breakdown?.[0]).toContain('transcript-received->first-response-text')
    expect(breakdown?.[0]).toContain('dominant')
  })

  it('cancel abandons the turn without a final mark', () => {
    beginVoiceLatencyTurn(0)
    cancelVoiceLatencyTurn()

    expect(markVoiceLatency('recorder-stopped')).toBeNull()
  })

  it('a new turn after cancel starts from a fresh t0', () => {
    beginVoiceLatencyTurn(5_000)
    cancelVoiceLatencyTurn()
    beginVoiceLatencyTurn(0)

    const seconds = markVoiceLatency('recorder-stopped')

    expect(seconds).not.toBeNull()
    expect(seconds!).toBeLessThan(1)
  })
})
