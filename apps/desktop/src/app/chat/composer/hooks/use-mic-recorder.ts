import { useEffect, useRef, useState } from 'react'

type BrowserAudioContext = typeof AudioContext

export interface EndOfTurnInfo {
  /** Trailing-silence window that elapsed before end-of-turn fired - lets the
   * caller backdate "when the user actually stopped talking" (0 when the turn
   * ended without any confirmed speech, e.g. the idle timeout). */
  confirmMs: number
  /** Cumulative speech heard this turn, in ms. */
  speechMs: number
}

export interface MicRecorderOptions {
  onLevel?: (level: number) => void
  onError?: (error: Error) => void
  onSilence?: (info: EndOfTurnInfo) => void
  silenceLevel?: number
  silenceMs?: number
  idleSilenceMs?: number
  /** Once at least this much cumulative speech time has been heard, a real
   * utterance is underway - switch to `fastSilenceMs` for the trailing-pause
   * confirm instead of the full `silenceMs`, so a normal-length turn doesn't
   * eat the whole patient window. Short/ambiguous starts (below this) still
   * get the safer, longer wait. Omit to keep the single fixed `silenceMs`. */
  fastSilenceAfterMs?: number
  /** Shorter trailing-silence confirm window used once `fastSilenceAfterMs`
   * of speech has accumulated. */
  fastSilenceMs?: number
}

export interface MicRecording {
  audio: Blob
  durationMs: number
  heardSpeech: boolean
}

export interface MicRecorderErrorCopy {
  microphoneAccessDenied: string
  microphoneConstraintsUnsupported: string
  microphoneInUse: string
  microphonePermissionDenied: string
  microphoneStartFailed: string
  microphoneUnsupported: string
  noMicrophone: string
}

interface MicRecorderHandle {
  start: (options?: MicRecorderOptions) => Promise<void>
  stop: () => Promise<MicRecording | null>
  cancel: () => void
}

function micError(error: unknown, copy: MicRecorderErrorCopy): Error {
  const name = error instanceof DOMException ? error.name : ''

  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return new Error(copy.microphonePermissionDenied)
  }

  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return new Error(copy.noMicrophone)
  }

  if (name === 'NotReadableError' || name === 'TrackStartError') {
    return new Error(copy.microphoneInUse)
  }

  if (name === 'OverconstrainedError') {
    return new Error(copy.microphoneConstraintsUnsupported)
  }

  if (error instanceof Error) {
    return error
  }

  return new Error(copy.microphoneStartFailed)
}

export function useMicRecorder(copy: MicRecorderErrorCopy): {
  handle: MicRecorderHandle
  level: number
  recording: boolean
} {
  const [level, setLevel] = useState(0)
  const [recording, setRecording] = useState(false)

  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const audioContextRef = useRef<AudioContext | null>(null)
  const animationRef = useRef<number | null>(null)
  const startedAtRef = useRef(0)
  const heardSpeechRef = useRef(false)
  const silenceTriggeredRef = useRef(false)
  const silenceStartedAtRef = useRef<number | null>(null)
  // Cumulative time spent above the speech threshold this turn, and the
  // wall-clock time of the previous tick (to derive each tick's dt) - see
  // `fastSilenceAfterMs`/`fastSilenceMs` on MicRecorderOptions.
  const speechAccumulatedMsRef = useRef(0)
  const lastTickAtRef = useRef<number | null>(null)
  const stopResolverRef = useRef<((recording: MicRecording | null) => void) | null>(null)

  const cleanup = () => {
    if (animationRef.current) {
      window.cancelAnimationFrame(animationRef.current)
      animationRef.current = null
    }

    void audioContextRef.current?.close()
    audioContextRef.current = null
    streamRef.current?.getTracks().forEach(track => track.stop())
    streamRef.current = null
    recorderRef.current = null
    setLevel(0)
    setRecording(false)
    silenceTriggeredRef.current = false
    lastTickAtRef.current = null
  }

  useEffect(() => () => cleanup(), [])

  const startMeter = (stream: MediaStream, options: MicRecorderOptions) => {
    const audioWindow = window as Window & { webkitAudioContext?: BrowserAudioContext }
    const AudioContextCtor = window.AudioContext || audioWindow.webkitAudioContext

    if (!AudioContextCtor) {
      return
    }

    try {
      const audioContext = new AudioContextCtor()
      const analyser = audioContext.createAnalyser()
      const source = audioContext.createMediaStreamSource(stream)

      // 1024 (~21ms @48kHz), not the old 256 (~5.3ms) - a window shorter than
      // a pitch period samples the raw waveform almost at random (peak vs.
      // trough) rather than its amplitude envelope, so the level readout
      // jittered frame to frame instead of tracking actual loudness. See the
      // matching note in lib/voice-analyser.ts for the TTS-playback side.
      analyser.fftSize = 1024
      const data = new Uint8Array(analyser.fftSize)

      source.connect(analyser)
      audioContextRef.current = audioContext

      const tick = () => {
        analyser.getByteTimeDomainData(data)

        let sum = 0

        for (const value of data) {
          const centered = value - 128
          sum += centered * centered
        }

        const rms = Math.sqrt(sum / data.length)
        const normalized = Math.min(1, rms / 42)
        const now = Date.now()
        const dtMs = lastTickAtRef.current === null ? 0 : now - lastTickAtRef.current
        lastTickAtRef.current = now

        setLevel(normalized)
        options.onLevel?.(normalized)

        const speechThreshold = options.silenceLevel ?? 0
        const silenceMs = options.silenceMs ?? 0
        const idleSilenceMs = options.idleSilenceMs ?? 0
        const fastSilenceAfterMs = options.fastSilenceAfterMs ?? 0
        const fastSilenceMs = options.fastSilenceMs ?? 0

        if (speechThreshold > 0 && options.onSilence && !silenceTriggeredRef.current) {
          if (normalized >= speechThreshold) {
            heardSpeechRef.current = true
            silenceStartedAtRef.current = null
            speechAccumulatedMsRef.current += dtMs
          } else if (heardSpeechRef.current && silenceMs > 0) {
            silenceStartedAtRef.current ??= now

            // Layered end-of-turn wait: once enough speech has accumulated to
            // be confident this is a real, completed utterance (not a false
            // start or mid-thought pause), a short trailing pause is enough
            // to take the turn - otherwise fall back to the patient window.
            const useFastConfirm =
              fastSilenceMs > 0 && fastSilenceAfterMs > 0 && speechAccumulatedMsRef.current >= fastSilenceAfterMs

            const confirmMs = useFastConfirm ? Math.min(fastSilenceMs, silenceMs) : silenceMs

            if (now - silenceStartedAtRef.current >= confirmMs) {
              silenceTriggeredRef.current = true

              if (import.meta.env.DEV) {
                console.debug(
                  `[voice] end-of-turn: ${useFastConfirm ? 'fast' : 'patient'} confirm (${confirmMs}ms), ${Math.round(speechAccumulatedMsRef.current)}ms of speech heard`
                )
              }

              options.onSilence({ confirmMs, speechMs: speechAccumulatedMsRef.current })

              return
            }
          } else if (!heardSpeechRef.current && idleSilenceMs > 0 && now - startedAtRef.current >= idleSilenceMs) {
            silenceTriggeredRef.current = true
            options.onSilence({ confirmMs: 0, speechMs: 0 })

            return
          }
        }

        animationRef.current = window.requestAnimationFrame(tick)
      }

      tick()
    } catch {
      setLevel(0)
    }
  }

  const start: MicRecorderHandle['start'] = async (options = {}) => {
    if (recorderRef.current) {
      return
    }

    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      throw new Error(copy.microphoneUnsupported)
    }

    const permitted = await window.jarvisDesktop?.requestMicrophoneAccess?.()

    if (permitted === false) {
      throw new Error(copy.microphoneAccessDenied)
    }

    let stream: MediaStream

    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true }
      })
    } catch (error) {
      throw micError(error, copy)
    }

    const mimeType =
      ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/ogg', 'audio/wav'].find(
        type => MediaRecorder.isTypeSupported(type)
      ) ?? ''

    let recorder: MediaRecorder

    try {
      recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
    } catch (error) {
      stream.getTracks().forEach(track => track.stop())
      throw micError(error, copy)
    }

    chunksRef.current = []
    streamRef.current = stream
    recorderRef.current = recorder
    heardSpeechRef.current = false
    silenceTriggeredRef.current = false
    silenceStartedAtRef.current = null
    speechAccumulatedMsRef.current = 0
    lastTickAtRef.current = null
    startedAtRef.current = Date.now()

    recorder.ondataavailable = event => {
      if (event.data.size > 0) {
        chunksRef.current.push(event.data)
      }
    }

    recorder.onstop = () => {
      const chunks = chunksRef.current
      const recordingType = recorder.mimeType || mimeType || 'audio/webm'
      const durationMs = Date.now() - startedAtRef.current
      const heardSpeech = heardSpeechRef.current

      chunksRef.current = []
      cleanup()

      const resolver = stopResolverRef.current
      stopResolverRef.current = null

      if (!chunks.length) {
        resolver?.(null)

        return
      }

      resolver?.({
        audio: new Blob(chunks, { type: recordingType }),
        durationMs,
        heardSpeech
      })
    }

    recorder.onerror = event => {
      const error = micError((event as Event & { error?: unknown }).error, copy)
      const resolver = stopResolverRef.current
      stopResolverRef.current = null
      cleanup()
      options.onError?.(error)
      resolver?.(null)
    }

    recorder.start()
    setRecording(true)
    startMeter(stream, options)
  }

  const stop: MicRecorderHandle['stop'] = () =>
    new Promise<MicRecording | null>(resolve => {
      const recorder = recorderRef.current

      if (!recorder || recorder.state === 'inactive') {
        cleanup()
        resolve(null)

        return
      }

      stopResolverRef.current = resolve
      recorder.stop()
    })

  const cancel: MicRecorderHandle['cancel'] = () => {
    const recorder = recorderRef.current
    const resolver = stopResolverRef.current
    stopResolverRef.current = null

    if (recorder && recorder.state !== 'inactive') {
      recorder.ondataavailable = null
      recorder.onerror = null
      recorder.onstop = null
      recorder.stop()
    }

    cleanup()
    resolver?.(null)
  }

  const handle: MicRecorderHandle = { start, stop, cancel }

  return { handle, level, recording }
}
