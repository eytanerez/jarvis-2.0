import { useCallback, useEffect, useState } from 'react'

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
 * Horizontal pixel offset that keeps the orb centered on the actual visible
 * content column instead of the whole window. `JarvisOrbBackdrop` is a
 * `fixed inset-0` layer mounted once at the shell root, so it never sees the
 * session sidebar / file browser / terminal / preview panes opening and
 * closing beside it - without this it stays dead-center in the window even
 * when a sidebar has pushed the actual chat surface off to one side.
 *
 * Measures `PaneShell`'s main column (`[data-pane-main="true"]`, always
 * present - it's the one pane slot every route renders into) rather than
 * summing individual pane widths, so it automatically accounts for any
 * combination of panes, resizing, hover-reveal, and the flipped layout
 * without duplicating that layout logic here.
 */
function useOrbCenterOffsetPx(): number {
  const [offsetPx, setOffsetPx] = useState(0)

  useEffect(() => {
    const mainEl = document.querySelector<HTMLElement>('[data-pane-main="true"]')

    if (!mainEl) {
      return
    }

    const measure = () => {
      const rect = mainEl.getBoundingClientRect()
      const contentCenter = rect.left + rect.width / 2
      const windowCenter = window.innerWidth / 2

      setOffsetPx(rect.width > 0 ? contentCenter - windowCenter : 0)
    }

    measure()

    const resizeObserver = new ResizeObserver(measure)
    resizeObserver.observe(mainEl)
    window.addEventListener('resize', measure)

    return () => {
      resizeObserver.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [])

  return offsetPx
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
  const centerOffsetPx = useOrbCenterOffsetPx()

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
      <JarvisOrbScene
        centerOffsetPx={centerOffsetPx}
        className="size-full"
        getLevel={getLevel}
        paused={paused}
        reducedMotion={reducedMotion}
        state={state}
      />
    </div>
  )
}
