import { beforeEach, describe, expect, it } from 'vitest'

import {
  $orbSpeaking,
  $orbThinking,
  $voiceSpeaking,
  $voiceTranscribing,
  resolveOrbState,
  setVoiceSpeaking,
  setVoiceTranscribing
} from '@/store/jarvis-cockpit'
import { $awaitingResponse, $busy } from '@/store/session'
import { $voicePlayback } from '@/store/voice-playback'

function playbackStatus(status: 'idle' | 'preparing' | 'speaking') {
  $voicePlayback.set({ ...$voicePlayback.get(), status })
}

describe('voice-loop orb signals', () => {
  beforeEach(() => {
    setVoiceSpeaking(false)
    setVoiceTranscribing(false)
    playbackStatus('idle')
    $busy.set(false)
    $awaitingResponse.set(false)
  })

  it('holds $orbSpeaking through the gap between sentence chunks', () => {
    // Chunk playing.
    setVoiceSpeaking(true)
    playbackStatus('speaking')
    expect($orbSpeaking.get()).toBe(true)

    // Chunk ended, next one still synthesizing - playback drops to idle but
    // the reply-wide hold keeps the orb in its speaking mood (this gap is
    // what used to slam the orb into thinking between every sentence).
    playbackStatus('idle')
    expect($orbSpeaking.get()).toBe(true)
    playbackStatus('preparing')
    expect($orbSpeaking.get()).toBe(true)

    // Reply finished.
    setVoiceSpeaking(false)
    playbackStatus('idle')
    expect($orbSpeaking.get()).toBe(false)
  })

  it('still reports speaking for non-voice-loop playback (message read-aloud)', () => {
    expect($voiceSpeaking.get()).toBe(false)
    playbackStatus('speaking')
    expect($orbSpeaking.get()).toBe(true)
  })

  it('counts the STT window as thinking so the orb never flashes idle mid-turn', () => {
    expect($orbThinking.get()).toBe(false)
    setVoiceTranscribing(true)
    expect($orbThinking.get()).toBe(true)
    expect($voiceTranscribing.get()).toBe(true)

    // Turn submitted: transcribing ends as the session stores take over.
    setVoiceTranscribing(false)
    $awaitingResponse.set(true)
    expect($orbThinking.get()).toBe(true)
  })

  it('keeps the speaking-over-thinking priority during a held reply', () => {
    expect(
      resolveOrbState({
        awaitingApproval: false,
        error: false,
        listening: false,
        speaking: true,
        thinking: true,
        toolActive: true
      })
    ).toBe('speaking')
  })
})
