import { atom, computed } from 'nanostores'

import type { OrbState } from '@/components/jarvis/orb'
import { $clarifyRequest } from '@/store/clarify'
import { $approvalRequest, $secretRequest, $sudoRequest } from '@/store/prompts'
import { $awaitingResponse, $busy, $messages } from '@/store/session'
import { $voicePlayback } from '@/store/voice-playback'

// Cockpit mode
// Orb is the default launch surface; classic swaps in the original scrolling
// thread for feature parity / debugging during the current renderer session.

export type CockpitMode = 'classic' | 'orb'

export const $cockpitMode = atom<CockpitMode>('orb')

export function setCockpitMode(mode: CockpitMode): void {
  $cockpitMode.set(mode)
}

export function toggleCockpitMode(): void {
  setCockpitMode($cockpitMode.get() === 'orb' ? 'classic' : 'orb')
}

// Live mic signal
// Published by the existing voice-conversation loop (use-voice-conversation) so
// the orb reacts to the real microphone without opening a second stream. The
// orb samples $micLevel every frame via .get() (never subscribes) to avoid
// pushing audio into React state at 60fps.

export const $micLevel = atom(0)
export const $micActive = atom(false)

export function setMicSignal(active: boolean, level: number): void {
  if ($micActive.get() !== active) {
    $micActive.set(active)
  }

  $micLevel.set(active ? level : 0)
}

// Orb-state signals derived from existing gateway/session stores.

export const $orbSpeaking = computed($voicePlayback, playback => playback.status === 'speaking')

export const $orbAwaitingApproval = computed(
  [$approvalRequest, $sudoRequest, $secretRequest, $clarifyRequest],
  (approval, sudo, secret, clarify) => Boolean(approval || sudo || secret || clarify)
)

// A tool is running while the pending assistant message carries a tool-call
// part that hasn't resolved (assistant-ui sets `result` only on completion).
export const $orbToolActive = computed($messages, messages => {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]

    if (message.role !== 'assistant') {
      continue
    }

    if (!message.pending) {
      return false
    }

    return message.parts.some(part => {
      const record = part as { result?: unknown; type?: string }

      return record.type === 'tool-call' && record.result == null
    })
  }

  return false
})

export const $orbError = computed($messages, messages => {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]

    if (message.hidden) {
      continue
    }

    return Boolean(message.error)
  }

  return false
})

export const $orbThinking = computed([$awaitingResponse, $busy], (awaiting, busy) => awaiting || busy)

export interface OrbStateInputs {
  awaitingApproval: boolean
  error: boolean
  listening: boolean
  speaking: boolean
  thinking: boolean
  toolActive: boolean
}

// Priority: a blocking prompt wins, then the user talking (barge-in), then the
// assistant speaking, then visible tool work, then thinking, else calm.
export function resolveOrbState(inputs: OrbStateInputs): OrbState {
  if (inputs.awaitingApproval) {
    return 'awaitingApproval'
  }

  if (inputs.error) {
    return 'error'
  }

  if (inputs.listening) {
    return 'listening'
  }

  if (inputs.speaking) {
    return 'speaking'
  }

  if (inputs.toolActive) {
    return 'toolUse'
  }

  if (inputs.thinking) {
    return 'thinking'
  }

  return 'idle'
}
