// The orb the native notch embeds (WKWebView → this page, served by the Vite
// dev server in dev; packaged serving lands with Phase 4 of the notch plan).
//
// It mounts the REAL JarvisOrbScene — same WebGL layers, shaders, and theme
// variables as the app background — so the notch orb is pixel-identical and
// inherits every future orb change for free. State + audio level arrive over
// the same loopback WebSocket the Swift app uses (`?port=&token=` query args,
// injected by electron/notch.cjs via the orbUrl message). Without a socket the
// orb renders calm idle, so the page also works standalone in a browser.
import '../styles.css'

import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'

import { JarvisOrbScene, type OrbState } from '@/components/jarvis-orb/JarvisOrbScene'

type NotchPhase = 'disconnected' | 'idle' | 'listening' | 'transcribing' | 'thinking' | 'speaking'

// `transcribing` reads as "working on what you said" — thinking, visually.
const PHASE_TO_ORB_STATE: Record<NotchPhase, OrbState> = {
  disconnected: 'idle',
  idle: 'idle',
  listening: 'listening',
  speaking: 'speaking',
  thinking: 'thinking',
  transcribing: 'thinking'
}

const RECONNECT_DELAY_MS = 2_000

// The camera distance that makes the sphere fill a small square viewport
// (`fill=1`, used by every notch surface). The imported styles.css paints the
// app's body gradient, which reads as a grey disc behind the orb inside the
// notch's circular clip — inline styles win over any stylesheet, so force the
// page transparent here.
const FILL_CAMERA_DISTANCE = 3.4

document.documentElement.style.background = 'transparent'
document.body.style.background = 'transparent'

function NotchOrb() {
  const [phase, setPhase] = useState<NotchPhase>('idle')
  const levelRef = useRef(0)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const port = params.get('port')
    const token = params.get('token')

    if (!port || !token) {
      return
    }

    let socket: WebSocket | null = null
    let reconnectTimer: number | null = null
    let disposed = false

    const connect = () => {
      if (disposed) {
        return
      }

      socket = new WebSocket(`ws://127.0.0.1:${port}/notch?token=${encodeURIComponent(token)}`)

      socket.onmessage = event => {
        let message: { type?: string; phase?: string; level?: number } | null = null

        try {
          message = JSON.parse(String(event.data))
        } catch {
          return
        }

        if (message?.type === 'state' && typeof message.phase === 'string' && message.phase in PHASE_TO_ORB_STATE) {
          setPhase(message.phase as NotchPhase)
        } else if (message?.type === 'audioLevel' && typeof message.level === 'number') {
          levelRef.current = Math.max(0, Math.min(1, message.level))
        } else if (message?.type === 'conversationEnded') {
          setPhase('idle')
          levelRef.current = 0
        }
      }

      socket.onclose = () => {
        levelRef.current = 0

        if (!disposed) {
          reconnectTimer = window.setTimeout(connect, RECONNECT_DELAY_MS)
        }
      }
    }

    connect()

    return () => {
      disposed = true

      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer)
      }

      socket?.close()
    }
  }, [])

  const fill = new URLSearchParams(window.location.search).get('fill') === '1'

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

createRoot(document.getElementById('root')!).render(<NotchOrb />)
