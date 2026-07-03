// The orb the Jarvis iOS app embeds (WKWebView → this page, bundled into the
// app's resources by `npm run mobile-orb:build`).
//
// Mounts the REAL JarvisOrbScene — same WebGL layers, shaders, and theme as
// the desktop app — so the phone orb is pixel-identical and inherits every
// future orb change for free. Unlike the notch variant there is no WebSocket:
// the Swift side owns all state and drives the scene through the tiny
// `window.jarvisOrb` API below (evaluateJavaScript), keeping the web layer a
// pure renderer that also works offline inside the bundle.
import '../styles.css'

import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'

import { JarvisOrbScene, type OrbState } from '@/components/jarvis-orb/JarvisOrbScene'

type MobilePhase = 'idle' | 'listening' | 'transcribing' | 'thinking' | 'speaking'

const PHASE_TO_ORB_STATE: Record<MobilePhase, OrbState> = {
  idle: 'idle',
  listening: 'listening',
  speaking: 'speaking',
  thinking: 'thinking',
  transcribing: 'thinking'
}

// Camera distance that makes the sphere fill a small square viewport (same
// value the notch surfaces use with fill=1).
const FILL_CAMERA_DISTANCE = 3.4

declare global {
  interface Window {
    // Named to avoid the scene's dev-only window.jarvisOrb debug console
    // (src/components/jarvis-orb/debug-console.ts).
    jarvisMobileOrb?: {
      setLevel: (level: number) => void
      setPhase: (phase: string) => void
    }
    webkit?: {
      messageHandlers?: {
        orb?: { postMessage: (message: unknown) => void }
      }
    }
  }
}

document.documentElement.style.background = 'transparent'
document.body.style.background = 'transparent'

function MobileOrb() {
  const [phase, setPhase] = useState<MobilePhase>('idle')
  const levelRef = useRef(0)

  useEffect(() => {
    window.jarvisMobileOrb = {
      setLevel: level => {
        if (typeof level === 'number' && Number.isFinite(level)) {
          levelRef.current = Math.max(0, Math.min(1, level))
        }
      },
      setPhase: next => {
        if (typeof next === 'string' && next in PHASE_TO_ORB_STATE) {
          setPhase(next as MobilePhase)

          if (next === 'idle') {
            levelRef.current = 0
          }
        }
      }
    }

    // Tell the native side the scene is live (it may re-push current state).
    window.webkit?.messageHandlers?.orb?.postMessage({ type: 'ready' })

    return () => {
      delete window.jarvisMobileOrb
    }
  }, [])

  const fill = new URLSearchParams(window.location.search).get('fill') !== '0'

  return (
    <JarvisOrbScene
      cameraDistance={fill ? FILL_CAMERA_DISTANCE : undefined}
      className="size-full"
      getLevel={() => levelRef.current}
      showBackground={false}
      state={PHASE_TO_ORB_STATE[phase]}
    />
  )
}

createRoot(document.getElementById('root')!).render(<MobileOrb />)
