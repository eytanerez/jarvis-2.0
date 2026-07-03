import { useCallback, useEffect, useRef, useState } from 'react'

import { useI18n } from '@/i18n'
import { warmupVoiceModels } from '@/jarvis'
import { beginVoiceLatencyTurn, cancelVoiceLatencyTurn, markVoiceLatency } from '@/lib/voice-latency'
import { playSpeechText, prefetchSpeechText, stopVoicePlayback } from '@/lib/voice-playback'
import { classifyVoiceSignoff } from '@/lib/voice-signoff'
import { setMicSignal, setVoiceSpeaking, setVoiceTranscribing } from '@/store/jarvis-cockpit'
import { notify, notifyError } from '@/store/notifications'

import { useMicRecorder } from './use-mic-recorder'

export type ConversationStatus = 'idle' | 'listening' | 'transcribing' | 'thinking' | 'speaking'

const MAX_SILENT_TURNS = 3
const VOICE_WARMUP_COOLDOWN_MS = 30_000

interface PendingVoiceResponse {
  id: string
  pending: boolean
  text: string
}

interface VoiceConversationOptions {
  busy: boolean
  enabled: boolean
  onFatalError?: () => void
  onSubmit: (text: string) => Promise<void> | void
  onTranscribeAudio?: (audio: Blob, options?: { partial?: boolean }) => Promise<string>
  /** Called when a turn is classified as a conversational sign-off (see
   * `classifyVoiceSignoff`) - the conversation is winding down gracefully,
   * not erroring out. Callers should treat this the same as ending the
   * conversation (e.g. turn off voice-conversation mode). */
  onSignoff?: () => void
  pendingResponse: () => PendingVoiceResponse | null
  consumePendingResponse: () => void
  /** Subscribe to changes of the underlying response stream (e.g. the
   * messages store). The pump effect below only re-runs when one of its
   * dependencies changes - without this, newly streamed text is only noticed
   * when some unrelated re-render happens to occur, which delays both the
   * first spoken chunk and the "hold one ahead" prefetch of the next one.
   * Returns an unsubscribe function. */
  subscribeToResponse?: (onChange: () => void) => () => void
}

// How often the live-caption loop posts the audio-so-far for a partial
// transcription while the user is talking. One request in flight at a time;
// a tick that finds the previous one still running is skipped, so a slow
// engine degrades to fewer updates instead of a backlog. (The old
// implementation used the browser SpeechRecognition API, which is a stub in
// Electron — no Google speech backend — so captions were permanently empty.)
const PARTIAL_TRANSCRIBE_INTERVAL_MS = 900

export function useVoiceConversation({
  busy,
  enabled,
  onFatalError,
  onSignoff,
  onSubmit,
  onTranscribeAudio,
  pendingResponse,
  consumePendingResponse,
  subscribeToResponse
}: VoiceConversationOptions) {
  const { t } = useI18n()
  const voiceCopy = t.notifications.voice
  const { handle, level } = useMicRecorder(voiceCopy)
  const [status, setStatus] = useState<ConversationStatus>('idle')
  const [muted, setMuted] = useState(false)
  const [liveTranscript, setLiveTranscript] = useState('')
  // Bumped on every response-stream change so the pump effect re-runs the
  // moment new text arrives (see `subscribeToResponse`).
  const [responseTick, setResponseTick] = useState(0)
  const turnTimeoutRef = useRef<number | null>(null)
  const pendingStartRef = useRef(false)
  const turnClosingRef = useRef(false)
  const awaitingSpokenResponseRef = useRef(false)
  // How many turns have been submitted this session - a sign-off is only
  // ever considered once at least one earlier turn has already gone all the
  // way through the assistant (turns are strictly sequential: the mic can't
  // start a new turn until the previous one's reply finished speaking or
  // errored out), so the very first thing someone says can never get
  // swallowed as a goodbye.
  const submittedTurnCountRef = useRef(0)
  const responseIdRef = useRef<string | null>(null)
  const silentTurnCountRef = useRef(0)
  const spokenSourceLengthRef = useRef(0)
  const speechBufferRef = useRef('')
  // Whether the current reply has dispatched its first spoken chunk yet -
  // the first chunk is allowed to break at an earlier soft boundary so the
  // assistant starts talking sooner; later chunks keep whole sentences.
  const firstChunkTakenRef = useRef(false)
  // Live-caption loop state: the interval handle, a single-in-flight latch,
  // and a generation counter that invalidates stale partial results after
  // the loop stops (the final transcript must never be overwritten by a
  // slower partial that resolves late).
  const partialTimerRef = useRef<number | null>(null)
  const partialInFlightRef = useRef(false)
  const partialGenerationRef = useRef(0)
  const warmupInFlightRef = useRef(false)
  const warmupStartedAtRef = useRef(0)
  const enabledRef = useRef(enabled)
  const mutedRef = useRef(muted)
  const busyRef = useRef(busy)
  const statusRef = useRef<ConversationStatus>('idle')
  const wasEnabledRef = useRef(enabled)

  useEffect(() => {
    enabledRef.current = enabled
  }, [enabled])

  useEffect(() => {
    mutedRef.current = muted
  }, [muted])

  useEffect(() => {
    busyRef.current = busy
  }, [busy])

  useEffect(() => {
    statusRef.current = status
  }, [status])

  // Publish the live mic signal for the J.A.R.V.I.S orb (reads it via .get()).
  useEffect(() => {
    setMicSignal(status === 'listening', level)
  }, [level, status])

  // Bridge the STT window into the orb's thinking state - between "user went
  // quiet" and "turn submitted" no session store is busy yet, and without this
  // the orb visibly drops back to idle for the transcription round-trip.
  useEffect(() => {
    setVoiceTranscribing(status === 'transcribing')
  }, [status])

  useEffect(
    () => () => {
      setMicSignal(false, 0)
      setVoiceTranscribing(false)
      setVoiceSpeaking(false)
    },
    []
  )

  useEffect(() => {
    if (!enabled || !subscribeToResponse) {
      return
    }

    return subscribeToResponse(() => setResponseTick(tick => tick + 1))
  }, [enabled, subscribeToResponse])

  const clearTurnTimeout = () => {
    if (turnTimeoutRef.current) {
      window.clearTimeout(turnTimeoutRef.current)
      turnTimeoutRef.current = null
    }
  }

  const requestWarmup = useCallback((reason: string) => {
    const now = Date.now()
    const lastStartedAt = warmupStartedAtRef.current

    if (warmupInFlightRef.current || (lastStartedAt > 0 && now - lastStartedAt < VOICE_WARMUP_COOLDOWN_MS)) {
      return
    }

    warmupInFlightRef.current = true
    warmupStartedAtRef.current = now
    markVoiceLatency('warmup-requested', reason)

    warmupVoiceModels()
      .then(result => {
        markVoiceLatency('warmup-response', result.started ? 'queued' : (result.reason ?? 'already warm/running'))
      })
      .catch(() => {})
      .finally(() => {
        warmupInFlightRef.current = false
      })
  }, [])

  const stopLiveTranscript = useCallback((clear = false) => {
    partialGenerationRef.current += 1

    if (partialTimerRef.current !== null) {
      window.clearInterval(partialTimerRef.current)
      partialTimerRef.current = null
    }

    if (clear) {
      setLiveTranscript('')
    }
  }, [])

  // Real as-you-speak captions: post the recorder's audio-so-far to the STT
  // endpoint (`partial: true`) on an interval and surface whatever comes
  // back. Best-effort by design — errors and busy-drops just mean the
  // caption lags a tick; the turn's final transcription is untouched.
  const startLiveTranscript = useCallback(() => {
    stopLiveTranscript(true)

    if (!onTranscribeAudio) {
      return
    }

    const generation = partialGenerationRef.current

    partialTimerRef.current = window.setInterval(() => {
      if (partialInFlightRef.current) {
        return
      }

      const snap = handle.snapshot()

      if (!snap || !snap.heardSpeech) {
        return
      }

      partialInFlightRef.current = true

      onTranscribeAudio(snap.audio, { partial: true })
        .then(text => {
          if (partialGenerationRef.current !== generation) {
            return
          }

          const cleaned = text.replace(/\s+/g, ' ').trim()

          // Empty = the engine was busy or heard nothing yet; keep the
          // previous caption rather than flickering it away.
          if (cleaned) {
            setLiveTranscript(cleaned)
          }
        })
        .catch(() => {})
        .finally(() => {
          partialInFlightRef.current = false
        })
    }, PARTIAL_TRANSCRIBE_INTERVAL_MS)
  }, [handle, onTranscribeAudio, stopLiveTranscript])

  const resetSpeechBuffer = () => {
    responseIdRef.current = null
    spokenSourceLengthRef.current = 0
    speechBufferRef.current = ''
    firstChunkTakenRef.current = false
  }

  const noteSilentTurn = useCallback(() => {
    silentTurnCountRef.current += 1

    if (silentTurnCountRef.current < MAX_SILENT_TURNS) {
      return true
    }

    pendingStartRef.current = false
    notify({ kind: 'warning', title: voiceCopy.noSpeechDetected, message: voiceCopy.tryRecordingAgain })
    onFatalError?.()

    return false
  }, [onFatalError, voiceCopy.noSpeechDetected, voiceCopy.tryRecordingAgain])

  const appendSpeechText = (text: string) => {
    if (!text) {
      return
    }

    speechBufferRef.current = `${speechBufferRef.current}${text}`
  }

  // `peek: true` returns the next chunk (if one is ready) without consuming
  // it from the buffer - used to prefetch its TTS audio one chunk ahead
  // while the current chunk is still speaking, without disturbing what
  // actually gets taken-and-spoken next.
  const takeSpeechChunk = (force = false, peek = false): string | null => {
    const buffer = speechBufferRef.current.replace(/\s+/g, ' ').trim()

    if (!buffer) {
      if (!peek) {
        speechBufferRef.current = ''
      }

      return null
    }

    const sentence = buffer.match(/^(.+?[.!?。！？])(?:\s+|$)/)

    if (sentence?.[1] && (sentence[1].length >= 8 || force)) {
      const chunk = sentence[1].trim()

      if (!peek) {
        speechBufferRef.current = buffer.slice(sentence[1].length).trim()
        firstChunkTakenRef.current = true
      }

      return chunk
    }

    // Soft (clause) boundary. The reply's first chunk gets much looser
    // thresholds: time-to-first-sound is the latency the user actually feels,
    // so a long opening sentence starts speaking at its first comma instead
    // of waiting for the period. Follow-up chunks keep whole sentences - the
    // pipeline is already ahead by then and prosody matters more than speed.
    const minBuffer = firstChunkTakenRef.current ? 220 : 110
    const searchTo = firstChunkTakenRef.current ? 180 : 100
    const minBoundary = firstChunkTakenRef.current ? 80 : 36

    if (!force && buffer.length > minBuffer) {
      const softBoundary = Math.max(
        buffer.lastIndexOf(', ', searchTo),
        buffer.lastIndexOf('; ', searchTo),
        buffer.lastIndexOf(': ', searchTo)
      )

      if (softBoundary > minBoundary) {
        const chunk = buffer.slice(0, softBoundary + 1).trim()

        if (!peek) {
          speechBufferRef.current = buffer.slice(softBoundary + 1).trim()
          firstChunkTakenRef.current = true
        }

        return chunk
      }
    }

    if (!force) {
      return null
    }

    if (!peek) {
      speechBufferRef.current = ''
      firstChunkTakenRef.current = true
    }

    return buffer
  }

  const handleTurn = useCallback(
    async (forceTranscribe = false) => {
      if (turnClosingRef.current) {
        return
      }

      turnClosingRef.current = true
      clearTurnTimeout()
      stopLiveTranscript()
      requestWarmup('transcribing')
      setStatus('transcribing')

      try {
        const result = await handle.stop()
        markVoiceLatency('recorder-stopped', result ? `${Math.round(result.audio.size / 1024)}KB audio` : 'no audio')

        if (!result || (!result.heardSpeech && !forceTranscribe) || !onTranscribeAudio) {
          cancelVoiceLatencyTurn()

          const shouldContinue = noteSilentTurn()

          if (
            shouldContinue &&
            enabledRef.current &&
            !mutedRef.current &&
            !busyRef.current &&
            statusRef.current !== 'speaking'
          ) {
            pendingStartRef.current = true
          }

          setStatus('idle')

          return
        }

        try {
          const transcript = (await onTranscribeAudio(result.audio)).trim()
          setLiveTranscript(transcript)
          markVoiceLatency('transcript-received', `${transcript.length} chars`)

          if (!transcript) {
            cancelVoiceLatencyTurn()
            setLiveTranscript('')

            const shouldContinue = noteSilentTurn()

            if (shouldContinue && enabledRef.current) {
              pendingStartRef.current = true
            }

            setStatus('idle')

            return
          }

          silentTurnCountRef.current = 0

          // Conservative sign-off check - runs before any model call, and
          // only once the assistant has actually said something already
          // this session. A clear "okay, thanks" ends the conversation for
          // free (no round trip); anything ambiguous falls through to a
          // normal reply.
          if (submittedTurnCountRef.current > 0) {
            const signoff = classifyVoiceSignoff(transcript)

            if (signoff.isSignoff) {
              if (import.meta.env.DEV) {
                console.debug(`[voice] sign-off detected ("${signoff.reason}") - ending conversation silently`)
              }

              cancelVoiceLatencyTurn()
              setLiveTranscript('')
              pendingStartRef.current = false
              setStatus('idle')
              onSignoff?.()

              return
            }
          }

          submittedTurnCountRef.current += 1
          awaitingSpokenResponseRef.current = true
          resetSpeechBuffer()
          await onSubmit(transcript)
          markVoiceLatency('turn-submitted')
          setStatus('thinking')
        } catch (error) {
          cancelVoiceLatencyTurn()
          notifyError(error, voiceCopy.transcriptionFailed)

          if (enabledRef.current && !mutedRef.current && !busyRef.current) {
            pendingStartRef.current = true
          }

          setStatus('idle')
        }
      } finally {
        turnClosingRef.current = false
      }
    },
    [
      handle,
      noteSilentTurn,
      onSignoff,
      onSubmit,
      onTranscribeAudio,
      requestWarmup,
      stopLiveTranscript,
      voiceCopy.transcriptionFailed
    ]
  )

  const startListening = useCallback(async () => {
    pendingStartRef.current = false

    if (!enabledRef.current || mutedRef.current || busyRef.current) {
      return
    }

    if (statusRef.current !== 'idle') {
      return
    }

    try {
      requestWarmup('listening')
      // VAD tuning mirrors `tools.voice_mode` defaults so the browser loop matches the CLI.
      // Layered end-of-turn wait: once ~1.2s of real speech has accumulated
      // (a confident, substantial utterance - not a false start), only a
      // short 600ms trailing pause is needed to take the turn instead of the
      // full 1.25s patient window. Short/ambiguous starts still get the
      // patient window so a mid-thought pause doesn't get clipped. (600ms was
      // bumped from 450ms after mid-sentence clipping on natural pauses.)
      await handle.start({
        silenceLevel: 0.075,
        silenceMs: 1_250,
        idleSilenceMs: 12_000,
        fastSilenceAfterMs: 1_200,
        fastSilenceMs: 600,
        onError: error => {
          notifyError(error, voiceCopy.microphoneFailed)
          pendingStartRef.current = false
          onFatalError?.()
        },
        onSilence: info => {
          beginVoiceLatencyTurn(info.confirmMs)
          void handleTurn()
        }
      })
      startLiveTranscript()
      setStatus('listening')
      turnTimeoutRef.current = window.setTimeout(() => {
        beginVoiceLatencyTurn(0)
        void handleTurn()
      }, 60_000)
    } catch (error) {
      notifyError(error, voiceCopy.couldNotStartSession)
      pendingStartRef.current = false
      setStatus('idle')
      onFatalError?.()
    }
  }, [
    handle,
    handleTurn,
    onFatalError,
    requestWarmup,
    startLiveTranscript,
    voiceCopy.couldNotStartSession,
    voiceCopy.microphoneFailed
  ])

  const speak = useCallback(
    async (text: string) => {
      setStatus('speaking')
      // Held true across ALL chunks of this reply (cleared by the pump's
      // completion branches / interrupt / end) so the orb doesn't drop out of
      // its speaking mood during the beat between sentence chunks.
      setVoiceSpeaking(true)

      try {
        await playSpeechText(text, { source: 'voice-conversation' })
      } catch (error) {
        notifyError(error, voiceCopy.playbackFailed)
      } finally {
        if (enabledRef.current) {
          pendingStartRef.current = true
          setStatus('idle')
        } else {
          setStatus('idle')
        }
      }
    },
    [voiceCopy.playbackFailed]
  )

  const start = useCallback(async () => {
    if (!onTranscribeAudio) {
      notify({
        kind: 'warning',
        title: voiceCopy.unavailable,
        message: voiceCopy.configureSpeechToText
      })
      onFatalError?.()

      return
    }

    // Fire-and-forget: pre-load local STT/TTS models server-side so the
    // session's first turn doesn't pay their cold model-load cost. Failures
    // are harmless - the first transcribe/speak call loads them anyway.
    requestWarmup('conversation-start')

    setMuted(false)
    silentTurnCountRef.current = 0
    submittedTurnCountRef.current = 0
    awaitingSpokenResponseRef.current = false
    resetSpeechBuffer()
    stopLiveTranscript(true)
    consumePendingResponse()
    pendingStartRef.current = true
    await startListening()
  }, [
    consumePendingResponse,
    onFatalError,
    onTranscribeAudio,
    requestWarmup,
    startListening,
    stopLiveTranscript,
    voiceCopy.configureSpeechToText,
    voiceCopy.unavailable
  ])

  const end = useCallback(async () => {
    cancelVoiceLatencyTurn()
    pendingStartRef.current = false
    clearTurnTimeout()
    stopVoicePlayback()
    handle.cancel()
    stopLiveTranscript(true)
    turnClosingRef.current = false
    silentTurnCountRef.current = 0
    submittedTurnCountRef.current = 0
    awaitingSpokenResponseRef.current = false
    setVoiceSpeaking(false)
    resetSpeechBuffer()
    consumePendingResponse()
    setMuted(false)
    setStatus('idle')
  }, [consumePendingResponse, handle, stopLiveTranscript])

  const stopTurn = useCallback(() => {
    if (statusRef.current === 'listening') {
      // Manual stop - the user chose this instant as end-of-turn, so no
      // confirm-window backdating.
      beginVoiceLatencyTurn(0)
      void handleTurn(true)
    }
  }, [handleTurn])

  // Manual barge-in: let the person tap to cut the assistant off mid-reply
  // and immediately start listening for what they want to say instead of
  // waiting for the rest of the (possibly long) spoken reply. Discards any
  // still-unspoken chunks of the current reply rather than continuing on to
  // the next sentence - a real interrupt, not just a "skip one sentence".
  //
  // This is a user-initiated stop, not automatic acoustic barge-in (the mic
  // doesn't stay hot while the assistant is speaking) - the mic and speaker
  // sharing a room without a headset makes automatic voice-triggered
  // barge-in unreliable (the assistant hearing itself), so that's left as a
  // deliberate follow-up rather than something to guess at here.
  const interruptSpeech = useCallback(() => {
    if (statusRef.current !== 'speaking') {
      return
    }

    awaitingSpokenResponseRef.current = false
    setVoiceSpeaking(false)
    resetSpeechBuffer()
    consumePendingResponse()
    stopVoicePlayback()
    pendingStartRef.current = true
  }, [consumePendingResponse])

  const toggleMute = useCallback(() => {
    setMuted(value => {
      const next = !value

      if (next) {
        clearTurnTimeout()
        handle.cancel()
        stopLiveTranscript(true)
        // Muting stops the pump effect, so the whole-reply speaking hold
        // would never get cleared - drop it now; any chunk still audibly
        // playing keeps the orb speaking via $voicePlayback itself.
        setVoiceSpeaking(false)
        setStatus('idle')
      } else if (enabledRef.current && !busyRef.current && statusRef.current === 'idle') {
        pendingStartRef.current = true
      }

      return next
    })
  }, [handle, stopLiveTranscript])

  useEffect(() => {
    if (!enabled) {
      return
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || event.repeat || event.metaKey || event.ctrlKey || event.altKey) {
        return
      }

      if (statusRef.current !== 'listening') {
        return
      }

      event.preventDefault()
      stopTurn()
    }

    window.addEventListener('keydown', onKeyDown, { capture: true })

    return () => window.removeEventListener('keydown', onKeyDown, { capture: true })
  }, [enabled, stopTurn])

  // Drive the loop: after a voice-submitted turn, speak stable chunks as the
  // assistant stream grows. Otherwise start listening when idle between turns.
  useEffect(() => {
    if (!enabled || muted) {
      return
    }

    if (awaitingSpokenResponseRef.current) {
      const response = pendingResponse()

      if (response) {
        if (response.id !== responseIdRef.current) {
          resetSpeechBuffer()
          responseIdRef.current = response.id
        }

        if (response.text.length > spokenSourceLengthRef.current) {
          if (spokenSourceLengthRef.current === 0) {
            markVoiceLatency('first-response-text', `${response.text.length} chars`)
          }

          appendSpeechText(response.text.slice(spokenSourceLengthRef.current))
          spokenSourceLengthRef.current = response.text.length
        }

        // A chunk is already speaking - don't dispatch another one yet, but
        // as soon as the next one is fully buffered, start synthesizing its
        // audio now ("hold one ahead") so it's ready the instant the
        // current chunk finishes instead of leaving dead air for the TTS
        // round-trip.
        if (status === 'speaking') {
          const upcoming = takeSpeechChunk(!response.pending && !busy, true)

          if (upcoming) {
            prefetchSpeechText(upcoming)
          }

          return
        }

        const chunk = takeSpeechChunk(!response.pending && !busy)

        if (chunk) {
          // Only logs for the first chunk of a turn - the latency turn is
          // closed by voice-playback once that chunk starts playing.
          markVoiceLatency('chunk-dispatched', `${chunk.length} chars`)
          void speak(chunk)

          return
        }

        if (!response.pending && !busy) {
          cancelVoiceLatencyTurn()
          awaitingSpokenResponseRef.current = false
          setVoiceSpeaking(false)
          consumePendingResponse()
          resetSpeechBuffer()
          pendingStartRef.current = true
          setStatus('idle')

          return
        }
      }

      if (!busy && status === 'thinking') {
        cancelVoiceLatencyTurn()
        awaitingSpokenResponseRef.current = false
        setVoiceSpeaking(false)
        resetSpeechBuffer()
        pendingStartRef.current = true
        setStatus('idle')

        return
      }
    }

    if (busy || status !== 'idle') {
      return
    }

    if (pendingStartRef.current) {
      void startListening()
    }
  }, [busy, consumePendingResponse, enabled, muted, pendingResponse, responseTick, speak, startListening, status])

  useEffect(() => {
    if (enabled && !wasEnabledRef.current) {
      void start()
    }

    if (!enabled && wasEnabledRef.current) {
      void end()
    }

    wasEnabledRef.current = enabled
  }, [enabled, end, start])

  return { end, interruptSpeech, level, liveTranscript, muted, start, status, stopTurn, toggleMute }
}
