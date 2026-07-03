import { useEffect, useRef } from 'react'

import { cn } from '@/lib/utils'
import { $orbPerformanceMode } from '@/store/orb-performance'
import { $activeSessionId } from '@/store/session'
import { $subagentsBySession } from '@/store/subagents'

import { installOrbDebugConsole } from './debug-console'
import { readCssColor } from './gl-utils'
import { OrbBackgroundLayer } from './OrbBackgroundLayer'
import { type LabelPlacement, type OrbColorPalette, OrbSceneLayer } from './OrbSceneLayer'
import { SubagentConstellationBridge } from './subagent-bridge'
import type { OrbGetLevel, OrbState } from './types'

export type { OrbState } from './types'

export interface JarvisOrbSceneProps {
  /** Camera pull-back for the orb layer. Omit for the app backdrop's default
   * framing; small embeds (notch web views) pass a closer distance so the
   * sphere fills the viewport. */
  cameraDistance?: number
  className?: string
  /** Horizontal pixel offset that recenters the orb (and its halo/rings/
   * constellation/labels) within the visible content area when a sidebar
   * pane is open - the starfield background layer is intentionally left
   * out of this shift so it keeps filling the whole window. */
  centerOffsetPx?: number
  /** Per-frame level sampler, 0-1. Preferred over the numeric props - lets the
   * parent feed live mic/TTS levels without pushing audio through React state. */
  getLevel?: OrbGetLevel
  listeningLevel?: number
  /** True while a full-screen panel covers the scene, or any other reason to
   * hold rendering - paired with document-hidden to fully cover Tier 6. */
  paused?: boolean
  reducedMotion?: boolean
  showBackground?: boolean
  speakingLevel?: number
  state: OrbState
}

function readColors(host: HTMLElement): OrbColorPalette {
  return {
    amber: readCssColor(host, '--theme-orb-listening'),
    approval: readCssColor(host, '--theme-orb-approval'),
    core: readCssColor(host, '--theme-orb-core'),
    error: readCssColor(host, '--theme-orb-error'),
    glow: readCssColor(host, '--theme-orb-glow'),
    particle: readCssColor(host, '--theme-orb-particle'),
    ring: readCssColor(host, '--theme-orb-ring')
  }
}

interface LabelEntry {
  root: HTMLDivElement
  name: HTMLSpanElement
  detail: HTMLDivElement
  dot: HTMLSpanElement
}

/**
 * Mounts the two WebGL2 layers (cosmic background, orb + constellation) plus
 * a thin DOM label layer on top, and drives them all from a single rAF loop.
 * Live audio/agent data is read imperatively via `.get()` every frame - none
 * of it flows through React state, so this component only re-renders when
 * its own props change (state/reducedMotion/paused), never at frame rate.
 */
export function JarvisOrbScene({
  cameraDistance,
  className,
  centerOffsetPx = 0,
  getLevel,
  listeningLevel = 0,
  paused = false,
  reducedMotion = false,
  showBackground = true,
  speakingLevel = 0,
  state
}: JarvisOrbSceneProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const bgCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const orbCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const labelLayerRef = useRef<HTMLDivElement | null>(null)

  const propsRef = useRef({ getLevel, listeningLevel, paused, reducedMotion, speakingLevel, state })
  propsRef.current = { getLevel, listeningLevel, paused, reducedMotion, speakingLevel, state }

  useEffect(() => {
    const container = containerRef.current
    const bgCanvas = bgCanvasRef.current
    const orbCanvas = orbCanvasRef.current
    const labelLayer = labelLayerRef.current

    if (!container || !orbCanvas || !labelLayer || (showBackground && !bgCanvas)) {
      return
    }

    const labelLayerEl = labelLayer
    const lowSpec = window.matchMedia('(max-width: 640px)').matches
    const background = showBackground && bgCanvas ? new OrbBackgroundLayer(bgCanvas, lowSpec) : null
    const scene = new OrbSceneLayer(orbCanvas, { cameraDistance })
    const bridge = new SubagentConstellationBridge()

    let colors = readColors(container)

    const themeObserver = new MutationObserver(() => {
      colors = readColors(container)
    })

    themeObserver.observe(document.documentElement, { attributeFilter: ['class', 'style'], attributes: true })

    const labelEls = new Map<string, LabelEntry>()

    function reconcileLabels(labels: readonly LabelPlacement[]) {
      const seen = new Set<string>()

      for (const label of labels) {
        seen.add(label.id)
        let entry = labelEls.get(label.id)

        if (!entry) {
          const root = document.createElement('div')
          root.className =
            'pointer-events-auto absolute left-0 top-0 flex select-none flex-col items-center gap-0.5 whitespace-nowrap will-change-transform'
          const name = document.createElement('div')
          name.className = 'flex items-center gap-1 text-[0.7rem] font-medium leading-tight text-(--theme-jarvis-text-tech)'
          const dot = document.createElement('span')
          dot.className = 'inline-block size-1.5 rounded-full'
          const nameText = document.createElement('span')
          name.append(dot, nameText)
          const detail = document.createElement('div')
          detail.className = 'max-w-[9rem] truncate text-[0.6rem] leading-tight text-(--theme-jarvis-text-dim)'
          root.append(name, detail)
          labelLayerEl.appendChild(root)
          entry = { detail, dot, name: nameText, root }
          labelEls.set(label.id, entry)
          root.style.opacity = '0'
        }

        entry.name.textContent = label.name
        entry.detail.textContent = label.detail
        const [r, g, b] = label.color
        entry.dot.style.backgroundColor = `rgb(${r * 255}, ${g * 255}, ${b * 255})`
        entry.root.style.transform = `translate3d(${label.x}px, ${label.y}px, 0) translate(-50%, 0.6rem) scale(${label.scale.toFixed(3)})`
        entry.root.style.opacity = label.opacity.toFixed(3)
        entry.root.style.zIndex = String(1000 + Math.round(label.depth * 50))
      }

      for (const [id, entry] of labelEls) {
        if (!seen.has(id)) {
          entry.root.remove()
          labelEls.delete(id)
        }
      }
    }

    let hideConstellation = lowSpec

    function resize() {
      scene.resize()
      background?.resize($orbPerformanceMode.get() ? 0.5 : 1)
      hideConstellation = container!.clientWidth < 640
    }

    const resizeObserver = new ResizeObserver(resize)
    resizeObserver.observe(container)
    resize()

    let raf = 0
    let running = true
    let wasPaused = false
    let lastFrame = performance.now()
    let frameParity = 0
    let lastOrbColor: [number, number, number] = [0.22, 0.64, 1]
    let lastOrbBrightness = 0.4

    const frame = (now: number) => {
      if (!running) {
        return
      }

      const p = propsRef.current

      if (p.paused || document.hidden) {
        wasPaused = true
        raf = requestAnimationFrame(frame)

        return
      }

      if (wasPaused) {
        lastFrame = now
        wasPaused = false
      }

      const dt = Math.min(0.1, Math.max(0, (now - lastFrame) / 1000))
      lastFrame = now

      const rawLevel = p.getLevel
        ? p.getLevel(p.state)
        : p.state === 'listening'
          ? p.listeningLevel
          : p.state === 'speaking'
            ? p.speakingLevel
            : 0

      const agents = bridge.sync($subagentsBySession.get(), $activeSessionId.get(), now)

      const perfMode = $orbPerformanceMode.get()
      frameParity = (frameParity + 1) % 2

      if (background && (!perfMode || frameParity === 0)) {
        background.render({
          orbBrightness: lastOrbBrightness,
          orbColor: lastOrbColor,
          reducedMotion: p.reducedMotion,
          time: now / 1000
        })
      }

      const output = scene.render({
        agents: hideConstellation ? [] : agents,
        colors,
        dt,
        nowMs: now,
        rawLevel,
        reducedMotion: p.reducedMotion,
        state: p.state
      })

      lastOrbColor = output.orbColor
      lastOrbBrightness = output.orbBrightness
      reconcileLabels(output.labels)

      raf = requestAnimationFrame(frame)
    }

    raf = requestAnimationFrame(frame)

    const onVisibility = () => {
      if (!document.hidden && running) {
        lastFrame = performance.now()
      }
    }

    document.addEventListener('visibilitychange', onVisibility)

    const unsubPerf = $orbPerformanceMode.subscribe(() => resize())
    const uninstallDebugConsole = import.meta.env.DEV ? installOrbDebugConsole() : undefined

    return () => {
      running = false
      cancelAnimationFrame(raf)
      document.removeEventListener('visibilitychange', onVisibility)
      unsubPerf()
      uninstallDebugConsole?.()
      themeObserver.disconnect()
      resizeObserver.disconnect()
      background?.dispose()
      scene.dispose()

      for (const entry of labelEls.values()) {
        entry.root.remove()
      }

      labelEls.clear()
    }
    // Mount once; live values flow through propsRef and store .get() reads.
    // cameraDistance only varies between hosts (app vs notch embed), never
    // within a mounted scene, so remounting on change is fine.
  }, [showBackground, cameraDistance])

  return (
    <div className={cn('jarvis-stage relative isolate overflow-hidden', className)} data-orb-state={state} ref={containerRef}>
      {showBackground ? <canvas aria-hidden="true" className="absolute inset-0 block size-full" ref={bgCanvasRef} /> : null}
      {/* Only the orb + labels recenter when a sidebar opens - the starfield
          background above stays untransformed so it keeps filling the whole
          window edge to edge. */}
      <div
        className="absolute inset-0 transition-transform duration-300 ease-out"
        style={{ transform: `translateX(${centerOffsetPx}px)` }}
      >
        <canvas aria-hidden="true" className="absolute inset-0 block size-full" ref={orbCanvasRef} />
        <div className="pointer-events-none absolute inset-0 hidden overflow-visible sm:block" ref={labelLayerRef} />
      </div>
    </div>
  )
}
