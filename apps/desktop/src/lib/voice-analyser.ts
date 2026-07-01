// Shared Web Audio analyser for the assistant's TTS <audio> element.
//
// `createMediaElementSource` may be called at most ONCE per element, so every
// consumer that wants to visualise playback (the composer's PlaybackWaveform,
// the J.A.R.V.I.S orb's speaking level) MUST route through this single cache -
// otherwise the second consumer throws. One AudioContext, one source + analyser
// per element, many readers.

type BrowserAudioContext = typeof AudioContext

interface ElementAnalyser {
  analyser: AnalyserNode
}

const elementAnalysers = new WeakMap<HTMLAudioElement, ElementAnalyser>()
let playbackAudioContext: AudioContext | null = null

function getPlaybackAudioContext(): AudioContext | null {
  if (playbackAudioContext && playbackAudioContext.state !== 'closed') {
    return playbackAudioContext
  }

  const audioWindow = window as Window & { webkitAudioContext?: BrowserAudioContext }
  const AudioContextCtor = window.AudioContext || audioWindow.webkitAudioContext

  if (!AudioContextCtor) {
    return null
  }

  playbackAudioContext = new AudioContextCtor()

  return playbackAudioContext
}

/**
 * Get (creating once) the shared AnalyserNode for a playback audio element.
 * fftSize 512 / smoothing 0.65 suits both the frequency-bar waveform and a
 * time-domain RMS read.
 */
export function getVoiceAnalyser(audioElement: HTMLAudioElement): AnalyserNode | null {
  let entry = elementAnalysers.get(audioElement)

  if (!entry) {
    const context = getPlaybackAudioContext()

    if (!context) {
      return null
    }

    const source = context.createMediaElementSource(audioElement)
    const analyser = context.createAnalyser()

    analyser.fftSize = 512
    analyser.smoothingTimeConstant = 0.65
    source.connect(analyser)
    analyser.connect(context.destination)
    entry = { analyser }
    elementAnalysers.set(audioElement, entry)
  }

  void playbackAudioContext?.resume()

  return entry.analyser
}

const sampleBuffers = new WeakMap<AnalyserNode, Uint8Array<ArrayBuffer>>()

/**
 * Instantaneous speaking level (0-1) for the current playback element. Uses the
 * same time-domain RMS normalization as the mic recorder so the orb reacts to
 * mic and TTS on a comparable scale. Safe to call every animation frame.
 */
export function sampleSpeakingLevel(audioElement: HTMLAudioElement | null): number {
  if (!audioElement) {
    return 0
  }

  const analyser = getVoiceAnalyser(audioElement)

  if (!analyser) {
    return 0
  }

  let data = sampleBuffers.get(analyser)

  if (!data || data.length !== analyser.fftSize) {
    data = new Uint8Array(analyser.fftSize)
    sampleBuffers.set(analyser, data)
  }

  analyser.getByteTimeDomainData(data)

  let sum = 0

  for (const value of data) {
    const centered = value - 128
    sum += centered * centered
  }

  const rms = Math.sqrt(sum / data.length)

  return Math.min(1, rms / 42)
}
