// Renderer half of the native-notch bridge.
//
// The Electron main process hosts a loopback WebSocket that the Swift notch
// app (and its embedded orb pages) listen on (electron/notch.cjs). This module
// is the single renderer-side funnel into it:
//
//   - The composer publishes the voice-conversation status here; we map it to
//     the notch's phase vocabulary and, while a conversation is live, pump the
//     real mic/TTS level at ~30 Hz (read via .get()/sampling exactly like the
//     orb backdrop — never through React state).
//   - Notch-originated commands (orb click, Option+Space later) arrive from
//     preload and land in `$notchCommand`; the composer consumes them and
//     drives the same start/end handlers as its own voice button.
//
// Everything is a no-op when the preload bridge is absent (non-mac platforms,
// notch disabled), so no caller needs to guard.

import { atom } from 'nanostores'

import type { ConversationStatus } from '@/app/chat/composer/hooks/use-voice-conversation'
import type { DesktopNotchSettingsSnapshot } from '@/global'
import { sampleSpeakingLevel } from '@/lib/voice-analyser'
import { $micLevel } from '@/store/jarvis-cockpit'
import { $voicePlayback } from '@/store/voice-playback'

export type NotchCommand = 'start' | 'end' | 'openSettings' | null

export const $notchCommand = atom<NotchCommand>(null)

export interface NotchTranscriptTurn {
  id: string
  role: 'user' | 'jarvis'
  text: string
  final: boolean
}

const LEVEL_INTERVAL_MS = 33

let commandUnsubscribe: (() => void) | null = null
let levelTimer: number | null = null
let lastStatus: ConversationStatus = 'idle'

export const EMPTY_NOTCH_SETTINGS_SNAPSHOT: DesktopNotchSettingsSnapshot = {
  connected: false,
  permissions: [],
  values: {}
}

function bridge() {
  return window.jarvisDesktop?.notch ?? null
}

/** Wire preload command events into `$notchCommand`. Idempotent; call once at app boot. */
export function initNotchLink(): void {
  const notch = bridge()

  if (!notch || commandUnsubscribe) {
    return
  }

  commandUnsubscribe = notch.onCommand(message => {
    switch (message.type) {
      case 'startConversation':
        $notchCommand.set('start')

        break

      case 'endConversation':
        $notchCommand.set('end')

        break

      case 'openSettings':
        $notchCommand.set('openSettings')

        break

      default:
        break
    }
  })
}

function stopLevelPump(): void {
  if (levelTimer !== null) {
    window.clearInterval(levelTimer)
    levelTimer = null
  }
}

function startLevelPump(): void {
  if (levelTimer !== null) {
    return
  }

  levelTimer = window.setInterval(() => {
    const notch = bridge()

    if (!notch) {
      return
    }

    let level = 0

    if (lastStatus === 'listening') {
      level = $micLevel.get()
    } else if (lastStatus === 'speaking') {
      level = sampleSpeakingLevel($voicePlayback.get().audioElement)
    }

    notch.publish({ level, type: 'audioLevel' })
  }, LEVEL_INTERVAL_MS)
}

/**
 * Publish the voice-conversation phase. The notch's phase vocabulary matches
 * `ConversationStatus` 1:1 (plus its own local `disconnected`).
 */
export function publishNotchStatus(status: ConversationStatus): void {
  const notch = bridge()

  if (!notch) {
    return
  }

  if (status !== lastStatus) {
    lastStatus = status
    notch.publish({ phase: status, type: 'state' })
  }

  if (status === 'listening' || status === 'speaking') {
    startLevelPump()
  } else {
    stopLevelPump()
  }
}

export function publishNotchTranscript(turns: NotchTranscriptTurn[]): void {
  bridge()?.publish({ turns, type: 'transcript' })
}

export async function getNotchSettings(): Promise<DesktopNotchSettingsSnapshot> {
  return (await bridge()?.getSettings()) ?? EMPTY_NOTCH_SETTINGS_SNAPSHOT
}

export async function requestNotchPermission(id: string): Promise<boolean> {
  return Boolean((await bridge()?.requestPermission(id))?.ok)
}

export async function setNotchSetting(key: string, value: unknown): Promise<boolean> {
  return Boolean((await bridge()?.setSetting(key, value))?.ok)
}

export function subscribeNotchSettings(callback: (snapshot: DesktopNotchSettingsSnapshot) => void): () => void {
  return bridge()?.onSettings(callback) ?? (() => {})
}
