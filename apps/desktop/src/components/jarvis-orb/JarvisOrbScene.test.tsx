// Governor tests for the orb render loop: full-rate (60fps cap) while the
// scene is active, 30fps while fully calm, parked (no renders at all) while
// the window is invisible. These pin the fix for the always-on GPU burn —
// background throttling is disabled app-wide, so before the governor the
// scene rendered at display rate 24/7, minimized or not.

import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { $windowVisible } from '@/store/window-visibility'

const sceneRender = vi.fn(() => ({ labels: [], orbBrightness: 0.4, orbColor: [0, 0, 0] as [number, number, number] }))
const backgroundRender = vi.fn()

vi.mock('./OrbSceneLayer', () => ({
  OrbSceneLayer: class {
    render = sceneRender
    resize = vi.fn()
    dispose = vi.fn()
  }
}))

vi.mock('./OrbBackgroundLayer', () => ({
  OrbBackgroundLayer: class {
    render = backgroundRender
    resize = vi.fn()
    dispose = vi.fn()
  }
}))

vi.mock('./subagent-bridge', () => ({
  SubagentConstellationBridge: class {
    sync = vi.fn(() => [])
  }
}))

import { JarvisOrbScene } from './JarvisOrbScene'

// Drive the mocked rAF like a 60Hz display for `frames` ticks.
function pump(frames: number, stepMs = 1000 / 60) {
  for (let i = 0; i < frames; i++) {
    clock += stepMs
    const queue = rafQueue.splice(0)
    for (const cb of queue) cb(clock)
    // Parked loops re-arm through setTimeout; let those fire when due.
    vi.advanceTimersByTime(stepMs)
  }
}

let clock = 0
let rafQueue: FrameRequestCallback[] = []

beforeEach(() => {
  vi.useFakeTimers()
  clock = 0
  rafQueue = []
  sceneRender.mockClear()
  backgroundRender.mockClear()
  $windowVisible.set(true)
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    rafQueue.push(cb)
    return rafQueue.length
  })
  vi.stubGlobal('cancelAnimationFrame', () => undefined)
  vi.spyOn(performance, 'now').mockImplementation(() => clock)
  // jsdom has no ResizeObserver or matchMedia by default in this suite.
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  )
  window.matchMedia ??= (query: string) =>
    ({ addEventListener: () => undefined, matches: false, media: query, removeEventListener: () => undefined }) as MediaQueryList
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function mountScene(state: 'idle' | 'listening') {
  return render(<JarvisOrbScene showBackground={false} state={state} />)
}

describe('JarvisOrbScene render governor', () => {
  it('renders at ~60fps while active (listening)', () => {
    mountScene('listening')
    pump(120) // two simulated seconds at 60Hz
    // 60fps cap: every tick of a 60Hz display renders (minus rounding slack).
    expect(sceneRender.mock.calls.length).toBeGreaterThanOrEqual(110)
    expect(sceneRender.mock.calls.length).toBeLessThanOrEqual(121)
  })

  it('halves the render rate while fully calm (idle, no audio, no agents)', () => {
    mountScene('idle')
    pump(120)
    // 30fps target on a 60Hz display: every other tick renders.
    expect(sceneRender.mock.calls.length).toBeGreaterThanOrEqual(55)
    expect(sceneRender.mock.calls.length).toBeLessThanOrEqual(66)
  })

  it('parks completely while the window is invisible and resumes on return', () => {
    $windowVisible.set(false)
    mountScene('listening')
    pump(120)
    expect(sceneRender).not.toHaveBeenCalled()

    $windowVisible.set(true)
    // The parked loop probes every 200ms via setTimeout; pumping advances
    // the fake timers, so the probe re-arms rAF and rendering resumes.
    pump(60)
    expect(sceneRender.mock.calls.length).toBeGreaterThan(0)
  })
})
