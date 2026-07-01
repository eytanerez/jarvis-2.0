import { useCallback } from 'react'

import { useMediaQuery } from '@/hooks/use-media-query'
import { sampleSpeakingLevel } from '@/lib/voice-analyser'
import { $micLevel, useOrbState } from '@/store/jarvis-cockpit'
import { $voicePlayback } from '@/store/voice-playback'

import { JarvisOrbScene, type OrbState } from './JarvisOrbScene'

export interface JarvisOrbBackdropProps {
  /** Hold rendering while a full-screen overlay (settings, menu, ...) covers the scene. */
  paused?: boolean
}

/**
 * Persistent cosmic backdrop for the whole shell - mounted once at the app
 * root so it fills the entire window (behind the sidebar, composer, titlebar,
 * and every overlay) instead of being boxed into a small circle inside the
 * chat pane. Orb state comes from the same global stores JarvisCockpit used
 * to own directly; see `useOrbState`.
 */
export function JarvisOrbBackdrop({ paused = false }: JarvisOrbBackdropProps) {
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)')
  const state = useOrbState()

  const getLevel = useCallback((orbState: OrbState) => {
    if (orbState === 'speaking') {
      return sampleSpeakingLevel($voicePlayback.get().audioElement)
    }

    if (orbState === 'listening') {
      return $micLevel.get()
    }

    return 0
  }, [])

  return (
    <div aria-hidden className="fixed inset-0 z-0" data-orb-backdrop>
      <JarvisOrbScene className="size-full" getLevel={getLevel} paused={paused} reducedMotion={reducedMotion} state={state} />
    </div>
  )
}
