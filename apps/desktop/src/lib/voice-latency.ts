/** Dev-only instrumentation for the voice-conversation loop.
 *
 * Measures the serial path between "the user stopped talking" and "the first
 * audible word of the reply" - the number that decides whether voice feels
 * responsive. A turn is opened when end-of-turn silence is confirmed
 * (backdated by the confirm window, since the user actually stopped talking
 * *before* the trailing-silence wait elapsed) and closed when the first audio
 * chunk starts playing; marks in between attribute the time to a stage
 * (recorder stop, STT, submit, first stream text, first chunk dispatch, TTS).
 *
 * All functions are no-ops outside dev builds and when no turn is open, so
 * call sites don't need their own guards.
 */

interface VoiceLatencyMark {
  detail?: string
  seconds: number
  stage: string
}

let turnStartedAt: number | null = null
let turnMarks: VoiceLatencyMark[] = []

function enabled(): boolean {
  return Boolean(import.meta.env.DEV)
}

/** Open a latency turn. `confirmWindowMs` is the trailing-silence window that
 * had to elapse before end-of-turn fired (0 for manual stops) - t0 is
 * backdated by it so the numbers mean "since the user stopped talking". */
export function beginVoiceLatencyTurn(confirmWindowMs: number): void {
  if (!enabled()) {
    return
  }

  turnStartedAt = performance.now() - Math.max(0, confirmWindowMs)
  turnMarks = [
    {
      detail: `confirm window ${Math.round(Math.max(0, confirmWindowMs))}ms`,
      seconds: 0,
      stage: 'stop-talking'
    }
  ]
  console.debug(`[voice-latency] turn start (t0 backdated ${Math.round(confirmWindowMs)}ms of confirm window)`)
}

/** Log a stage of the open turn. Returns seconds since the user stopped
 * talking, or null when no turn is open (later chunks of a reply, dictation,
 * production builds). */
export function markVoiceLatency(stage: string, detail?: string): number | null {
  if (!enabled() || turnStartedAt === null) {
    return null
  }

  const seconds = (performance.now() - turnStartedAt) / 1000
  turnMarks.push({ detail, seconds, stage })
  console.debug(`[voice-latency] ${stage} t+${seconds.toFixed(2)}s${detail ? ` (${detail})` : ''}`)

  return seconds
}

function logVoiceLatencyBreakdown(): void {
  if (!enabled() || turnMarks.length < 2) {
    return
  }

  const segments = []
  let dominant: { delta: number; label: string } | null = null

  for (let i = 1; i < turnMarks.length; i += 1) {
    const previous = turnMarks[i - 1]!
    const current = turnMarks[i]!
    const delta = Math.max(0, current.seconds - previous.seconds)
    const label = `${previous.stage}->${current.stage}`

    segments.push(`${label} ${delta.toFixed(2)}s`)

    if (!dominant || delta > dominant.delta) {
      dominant = { delta, label }
    }
  }

  console.debug(
    `[voice-latency] breakdown ${segments.join(' | ')}${dominant ? ` | dominant ${dominant.label} ${dominant.delta.toFixed(2)}s` : ''}`
  )
}

/** Log the final stage (normally `first-audio` - the headline number) and
 * close the turn so later marks become no-ops. */
export function endVoiceLatencyTurn(stage: string, detail?: string): number | null {
  const seconds = markVoiceLatency(stage, detail)
  logVoiceLatencyBreakdown()
  turnStartedAt = null
  turnMarks = []

  return seconds
}

/** Abandon the open turn without a final mark (turn errored out, sign-off,
 * silent turn) so a stale t0 can't leak into the next turn's numbers. */
export function cancelVoiceLatencyTurn(): void {
  turnStartedAt = null
  turnMarks = []
}
