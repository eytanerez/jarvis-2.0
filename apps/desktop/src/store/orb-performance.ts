// Orb scene performance mode: halves the background layer's resolution and
// renders it every other frame. The background drifts slowly enough that the
// lower framerate is invisible, and it's the most expensive part of the scene.

import { atom } from 'nanostores'

import { persistString, storedString } from '@/lib/storage'

const KEY = 'jarvis.desktop.orb-performance-mode.v1'

export const $orbPerformanceMode = atom<boolean>(typeof window === 'undefined' ? false : storedString(KEY) === '1')

export function setOrbPerformanceMode(enabled: boolean): void {
  $orbPerformanceMode.set(enabled)
}

export function toggleOrbPerformanceMode(): void {
  setOrbPerformanceMode(!$orbPerformanceMode.get())
}

if (typeof window !== 'undefined') {
  $orbPerformanceMode.subscribe(enabled => {
    persistString(KEY, enabled ? '1' : '0')
  })
}
