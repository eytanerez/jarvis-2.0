import { useCallback, useEffect, useRef, useState } from 'react'

import { useI18n } from '@/i18n'
import { playSpeechText, prefetchSpeechText, stopVoicePlayback } from '@/lib/voice-playback'
import { classifyVoiceSignoff } from '@/lib/voice-signoff'
import { setMicSignal } from '@/store/jarvis-cockpit'
import { notify, notifyError } from '@/store/notifications'

import { useMicRecorder } from './use-mic-recorder'

export type ConversationStatus = 'idle' | 'listening' | 'transcribing' | 'thinking' | 'speaking'

const MAX_SILENT_TURNS = 3

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
  onTranscribeAudio?: (audio: Blob) => Promise<string>
  /** Called when a turn is classified as a conversational sign-off (see
   * `classifyVoiceSignoff`) - the conversation is winding down gracefully,
   * not erroring out. Callers should treat this the same as ending the
   * conversation (e.g. turn off voice-conversation mode). */
  onSignoff?: () => void
  pendingResponse: () => PendingVoiceResponse | null
  consumePendingResponse: () => void
}

export function useVoiceConversation({
  busy,
  enabled,
  onFatalError,
  onSignoff,
  onSubmit,
  onTranscribeAudio,
  pendingResponse,
  consumePendingResponse
}: VoiceConversationOptions) {
  const { t } = useI18n()
  const voiceCopy = t.notifications.voice
  const { handle, level } = useMicRecorder(voiceCopy)
  const [status, setStatus] = useState<ConversationStatus>('idle')
  const [muted, setMuted] = useState(false)
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

  useEffect(() => () => setMicSignal(false, 0), [])

  const clearTurnTimeout = () => {
    if (turnTimeoutRef.current) {
      window.clearTimeout(turnTimeoutRef.current)
      turnTimeoutRef.current = null
    }
  }

  const resetSpeechBuffer = () => {
    responseIdRef.current = null
    spokenSourceLengthRef.current = 0
    speechBufferRef.current = ''
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
      }

      return chunk
    }

    if (!force && buffer.length > 220) {
      const softBoundary = Math.max(
        buffer.lastIndexOf(', ', 180),
        buffer.lastIndexOf('; ', 180),
        buffer.lastIndexOf(': ', 180)
      )

      if (softBoundary > 80) {
        const chunk = buffer.slice(0, softBoundary + 1).trim()

        if (!peek) {
          speechBufferRef.current = buffer.slice(softBoundary + 1).trim()
        }

        return chunk
      }
    }

    if (!force) {
      return null
    }

    if (!peek) {
      speechBufferRef.current = ''
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
      setStatus('transcribing')

      try {
        const result = await handle.stop()

        if (!result || (!result.heardSpeech && !forceTranscribe) || !onTranscribeAudio) {
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

          if (!transcript) {
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
          setStatus('thinking')
        } catch (error) {
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
    [handle, noteSilentTurn, onSignoff, onSubmit, onTranscribeAudio, voiceCopy.transcriptionFailed]
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
      // VAD tuning mirrors `tools.voice_mode` defaults so the browser loop matches the CLI.
      // Layered end-of-turn wait: once ~1.2s of real speech has accumulated
      // (a confident, substantial utterance - not a false start), only a
      // short 450ms trailing pause is needed to take the turn instead of the
      // full 1.25s patient window. Short/ambiguous starts still get the
      // patient window so a mid-thought pause doesn't get clipped.
      await handle.start({
        silenceLevel: 0.075,
        silenceMs: 1_250,
        idleSilenceMs: 12_000,
        fastSilenceAfterMs: 1_200,
        fastSilenceMs: 450,
        onError: error => {
          notifyError(error, voiceCopy.microphoneFailed)
          pendingStartRef.current = false
          onFatalError?.()
        },
        onSilence: () => void handleTurn()
      })
      setStatus('listening')
      turnTimeoutRef.current = window.setTimeout(() => void handleTurn(), 60_000)
    } catch (error) {
      notifyError(error, voiceCopy.couldNotStartSession)
      pendingStartRef.current = false
      setStatus('idle')
      onFatalError?.()
    }
  }, [handle, handleTurn, onFatalError, voiceCopy.couldNotStartSession, voiceCopy.microphoneFailed])

  const speak = useCallback(
    async (text: string) => {
      setStatus('speaking')

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

    setMuted(false)
    silentTurnCountRef.current = 0
    submittedTurnCountRef.current = 0
    awaitingSpokenResponseRef.current = false
    resetSpeechBuffer()
    consumePendingResponse()
    pendingStartRef.current = true
    await startListening()
  }, [
    consumePendingResponse,
    onFatalError,
    onTranscribeAudio,
    startListening,
    voiceCopy.configureSpeechToText,
    voiceCopy.unavailable
  ])

  const end = useCallback(async () => {
    pendingStartRef.current = false
    clearTurnTimeout()
    stopVoicePlayback()
    handle.cancel()
    turnClosingRef.current = false
    silentTurnCountRef.current = 0
    submittedTurnCountRef.current = 0
    awaitingSpokenResponseRef.current = false
    resetSpeechBuffer()
    consumePendingResponse()
    setMuted(false)
    setStatus('idle')
  }, [consumePendingResponse, handle])

  const stopTurn = useCallback(() => {
    if (statusRef.current === 'listening') {
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
        setStatus('idle')
      } else if (enabledRef.current && !busyRef.current && statusRef.current === 'idle') {
        pendingStartRef.current = true
      }

      return next
    })
  }, [handle])

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
          void speak(chunk)

          return
        }

        if (!response.pending && !busy) {
          awaitingSpokenResponseRef.current = false
          consumePendingResponse()
          resetSpeechBuffer()
          pendingStartRef.current = true
          setStatus('idle')

          return
        }
      }

      if (!busy && status === 'thinking') {
        awaitingSpokenResponseRef.current = false
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
  }, [busy, consumePendingResponse, enabled, muted, pendingResponse, speak, startListening, status])

  useEffect(() => {
    if (enabled && !wasEnabledRef.current) {
      void start()
    }

    if (!enabled && wasEnabledRef.current) {
      void end()
    }

    wasEnabledRef.current = enabled
  }, [enabled, end, start])

  return { end, interruptSpeech, level, muted, start, status, stopTurn, toggleMute }
}
