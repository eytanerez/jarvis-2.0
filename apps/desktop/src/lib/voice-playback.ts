import { speakText } from '@/jarvis'
import { endVoiceLatencyTurn, markVoiceLatency } from '@/lib/voice-latency'
import {
  $voicePlayback,
  setVoicePlaybackState,
  type VoicePlaybackSource,
  type VoicePlaybackState
} from '@/store/voice-playback'
import type { AudioSpeakResponse } from '@/types/jarvis'

import { sanitizeTextForSpeech } from './speech-text'

let currentAudio: HTMLAudioElement | null = null
let currentStop: (() => void) | null = null
let sequence = 0

// Single-slot "hold one ahead" cache: while one sentence chunk is playing,
// the voice-conversation loop kicks off synthesis for the next one so it's
// ready the instant the current chunk finishes, instead of paying the TTS
// round-trip in the gap between sentences. Keyed on the exact sanitized
// text so `playSpeechText` can only reuse a prefetch that's actually for
// the chunk it was asked to speak.
let prefetched: { text: string; promise: Promise<AudioSpeakResponse> } | null = null

/** Start synthesizing `text` ahead of when it'll actually be spoken. Safe to
 * call speculatively - a prefetch that's never claimed by `playSpeechText`
 * (e.g. the turn ends first) is just a discarded request. */
export function prefetchSpeechText(text: string): void {
  const speakableText = sanitizeTextForSpeech(text)

  if (!speakableText || prefetched?.text === speakableText) {
    return
  }

  prefetched = { text: speakableText, promise: speakText(speakableText) }
  // Prefetch failures surface when playback actually claims the promise;
  // silence the otherwise-unhandled rejection on the speculative path.
  prefetched.promise.catch(() => {})
}

function currentState(
  status: VoicePlaybackState['status'],
  options?: VoicePlaybackOptions,
  audioElement: HTMLAudioElement | null = null
): VoicePlaybackState {
  return {
    audioElement,
    messageId: options?.messageId ?? null,
    sequence,
    source: options?.source ?? null,
    status
  }
}

export interface VoicePlaybackOptions {
  messageId?: string | null
  source: VoicePlaybackSource
}

export function stopVoicePlayback() {
  sequence += 1
  currentStop?.()
  currentStop = null

  if (currentAudio) {
    currentAudio.pause()
    currentAudio.src = ''
    currentAudio.load()
    currentAudio = null
  }

  setVoicePlaybackState({
    audioElement: null,
    messageId: null,
    sequence,
    source: null,
    status: 'idle'
  })
}

export async function playSpeechText(text: string, options: VoicePlaybackOptions): Promise<boolean> {
  stopVoicePlayback()

  const speakableText = sanitizeTextForSpeech(text)

  if (!speakableText) {
    return false
  }

  // Reuse a matching "hold one ahead" prefetch instead of paying the TTS
  // round-trip again - see `prefetchSpeechText`.
  const claimedPrefetch = prefetched?.text === speakableText ? prefetched : null

  if (claimedPrefetch) {
    prefetched = null
  }

  const ownSequence = sequence
  const isCurrent = () => ownSequence === sequence
  const preparedAt = performance.now()

  setVoicePlaybackState(currentState('preparing', options))

  try {
    const response = await (claimedPrefetch ? claimedPrefetch.promise : speakText(speakableText))

    if (!isCurrent()) {
      return false
    }

    markVoiceLatency('tts-audio-received', claimedPrefetch ? 'prefetch hit' : 'prefetch miss')

    const audio = new Audio(response.data_url)
    audio.preload = 'auto'
    currentAudio = audio
    setVoicePlaybackState(currentState('speaking', options, audio))

    // Per-chunk synth-gap diagnostics for the voice loop: how long this
    // chunk waited on TTS before sound started, and whether the "hold one
    // ahead" prefetch actually absorbed that wait. Closes the latency turn
    // on the first audible chunk (no-op for the rest of the reply).
    if (import.meta.env.DEV && options.source === 'voice-conversation') {
      audio.addEventListener(
        'playing',
        () => {
          const waitedMs = Math.round(performance.now() - preparedAt)
          endVoiceLatencyTurn('first-audio', `${waitedMs}ms from dispatch to sound`)
          console.debug(
            `[voice] chunk audible after ${waitedMs}ms (${claimedPrefetch ? 'prefetch hit' : 'prefetch miss'}, ${speakableText.length} chars)`
          )
        },
        { once: true }
      )
    }

    await new Promise<void>((resolve, reject) => {
      let settled = false

      const cleanup = () => {
        audio.removeEventListener('ended', onEnded)
        audio.removeEventListener('error', onError)
        currentStop = null
      }

      const onEnded = () => {
        if (settled) {
          return
        }

        settled = true
        cleanup()
        resolve()
      }

      const onError = () => {
        if (settled) {
          return
        }

        settled = true
        cleanup()
        reject(new Error('Playback failed'))
      }

      currentStop = () => {
        if (settled) {
          return
        }

        settled = true
        cleanup()
        resolve()
      }

      audio.addEventListener('ended', onEnded, { once: true })
      audio.addEventListener('error', onError, { once: true })
      void audio.play().catch(error => {
        if (settled) {
          return
        }

        settled = true
        cleanup()
        reject(error instanceof Error ? error : new Error('Playback failed'))
      })
    })

    if (!isCurrent()) {
      return false
    }

    currentAudio = null
    setVoicePlaybackState(currentState('idle'))

    return true
  } catch (error) {
    if (isCurrent()) {
      currentStop = null
      currentAudio = null
      setVoicePlaybackState(currentState('idle'))
    }

    throw error
  }
}

export function isVoicePlaybackActive() {
  return $voicePlayback.get().status !== 'idle'
}
