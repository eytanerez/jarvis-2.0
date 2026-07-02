import { buildAvatarCanvas, buildGlowDotCanvas, buildRingCanvas } from './avatar-texture'
import {
  createFloatBuffer,
  createIndexBuffer,
  createProgram,
  resizeCanvasToDisplaySize,
  setAttribute,
  textureFromCanvas,
  uniformLocations
} from './gl-utils'
import {
  clamp,
  composeMat4,
  damp,
  lookAt4,
  multiply4,
  perspective4,
  projectToScreen,
  rotateX,
  rotateY,
  rotationX4,
  rotationY4,
  scaling4,
  smoothstep,
  type Vec3
} from './math'
import { buildIcoMesh } from './orb-mesh'
import { BILLBOARD_FRAG, BILLBOARD_VERT, RIBBON_FRAG, RIBBON_VERT, RING_FRAG, RING_VERT, WIREFRAME_FRAG, WIREFRAME_VERT } from './orb-shaders'
import { LEVEL_ATTACK_RATE, LEVEL_RELEASE_RATE, MOOD_EASE_RATE, MOOD_TARGETS, type MoodTarget } from './state-moods'
import { DISPATCH_FLARE_MS, FADE_OUT_MS } from './subagent-bridge'
import type { ConstellationAgent, OrbState } from './types'

type RGB = [number, number, number]

export interface OrbColorPalette {
  core: RGB
  glow: RGB
  ring: RGB
  particle: RGB
  error: RGB
  approval: RGB
  amber: RGB
}

export interface OrbFrameInput {
  nowMs: number
  dt: number
  state: OrbState
  rawLevel: number
  reducedMotion: boolean
  agents: ConstellationAgent[]
  colors: OrbColorPalette
}

export interface LabelPlacement {
  id: string
  name: string
  detail: string
  x: number
  y: number
  opacity: number
  scale: number
  depth: number
  color: RGB
}

export interface OrbFrameOutput {
  labels: LabelPlacement[]
  orbColor: RGB
  orbBrightness: number
}

const HELIX_TEAL: RGB = [0.15, 0.85, 0.72]
const HELIX_PURPLE: RGB = [0.58, 0.36, 0.96]
const RING_COUNT = 4
const RING_SEGMENTS = 96
const AGENT_BASE_SIZE_PX = 30
const HALO_BASE_RADIUS = 1.35

interface Ping {
  id: string
  bornAt: number
  pos: Vec3
  color: RGB
  lifespanMs: number
  maxSizePx: number
}

interface AgentFx {
  peakPingSpawned: boolean
}

function mixColor(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
}

export class OrbSceneLayer {
  private gl: WebGL2RenderingContext
  private wireframeProgram: WebGLProgram
  private billboardProgram: WebGLProgram
  private ribbonProgram: WebGLProgram
  private ringProgram: WebGLProgram

  private meshPositions: WebGLBuffer
  private meshEdgeIndices: WebGLBuffer
  private edgeIndexCount: number
  private quadBuffer: WebGLBuffer
  private ringUnitBuffer: WebGLBuffer
  private ringVertexCount = 0

  private glowDotTexture: WebGLTexture
  private ringTexture: WebGLTexture
  private avatarTextures = new Map<string, { tex: WebGLTexture; color: RGB }>()

  private ribbonBuffer: WebGLBuffer
  private ribbonCapacity = 0

  private startMs = performance.now()
  private mood: MoodTarget = { ...MOOD_TARGETS.idle }
  private level = 0
  private spinAngle = 0
  private currentAccent: RGB = [0.22, 0.64, 1]
  private ringActivity = 0

  private fx = new Map<string, AgentFx>()
  private pings: Ping[] = []
  private lastWaveAt = 0

  constructor(private canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { alpha: true, antialias: true, premultipliedAlpha: false })

    if (!gl) {
      throw new Error('[jarvis-orb] scene: WebGL2 unavailable')
    }

    this.gl = gl
    this.wireframeProgram = createProgram(gl, WIREFRAME_VERT, WIREFRAME_FRAG)
    this.billboardProgram = createProgram(gl, BILLBOARD_VERT, BILLBOARD_FRAG)
    this.ribbonProgram = createProgram(gl, RIBBON_VERT, RIBBON_FRAG)
    this.ringProgram = createProgram(gl, RING_VERT, RING_FRAG)

    const mesh = buildIcoMesh(3)
    this.meshPositions = createFloatBuffer(gl, mesh.positions)
    this.meshEdgeIndices = createIndexBuffer(gl, mesh.edgeIndices)
    this.edgeIndexCount = mesh.edgeIndices.length

    this.quadBuffer = createFloatBuffer(gl, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]))

    // A closed ribbon strip (inner+outer vertex per angle step) so the helix
    // rings render as a true-width glowing band rather than a 1px hairline -
    // gl.lineWidth is clamped to 1 on most implementations, so LINE_LOOP alone
    // can't guarantee a visible "thin glowing ring" across devices.
    const ringVerts = new Float32Array((RING_SEGMENTS + 1) * 2 * 3)
    let ro = 0

    for (let i = 0; i <= RING_SEGMENTS; i++) {
      const a = (i / RING_SEGMENTS) * Math.PI * 2
      const cx = Math.cos(a)
      const cy = Math.sin(a)
      ringVerts.set([cx, cy, -1, cx, cy, 1], ro)
      ro += 6
    }

    this.ringUnitBuffer = createFloatBuffer(gl, ringVerts)
    this.ringVertexCount = (RING_SEGMENTS + 1) * 2

    this.glowDotTexture = textureFromCanvas(gl, buildGlowDotCanvas())
    this.ringTexture = textureFromCanvas(gl, buildRingCanvas())

    this.ribbonBuffer = gl.createBuffer()!
  }

  resize(): void {
    resizeCanvasToDisplaySize(this.canvas, 2)
  }

  private ensureAvatarTexture(agent: ConstellationAgent): WebGLTexture {
    const cached = this.avatarTextures.get(agent.id)

    if (cached && cached.color[0] === agent.color[0] && cached.color[1] === agent.color[1] && cached.color[2] === agent.color[2]) {
      return cached.tex
    }

    cached?.tex && this.gl.deleteTexture(cached.tex)
    const tex = textureFromCanvas(this.gl, buildAvatarCanvas(agent.color, agent.initial))
    this.avatarTextures.set(agent.id, { color: agent.color, tex })

    return tex
  }

  private pruneAvatarTextures(activeIds: Set<string>): void {
    for (const [id, entry] of this.avatarTextures) {
      if (!activeIds.has(id)) {
        this.gl.deleteTexture(entry.tex)
        this.avatarTextures.delete(id)
        this.fx.delete(id)
      }
    }
  }

  private drawBillboard(
    texture: WebGLTexture,
    centerPx: [number, number],
    sizePx: number,
    color: RGB,
    alpha: number,
    rotation = 0
  ): void {
    const gl = this.gl
    gl.useProgram(this.billboardProgram)
    setAttribute(gl, this.billboardProgram, this.quadBuffer, 'a_quad', 2)
    const u = uniformLocations(gl, this.billboardProgram, ['u_centerPx', 'u_sizePx', 'u_viewport', 'u_tex', 'u_color', 'u_alpha', 'u_rotation'] as const)
    gl.uniform2f(u.u_centerPx, centerPx[0], centerPx[1])
    gl.uniform2f(u.u_sizePx, sizePx, sizePx)
    gl.uniform2f(u.u_viewport, this.canvas.width, this.canvas.height)
    gl.uniform3f(u.u_color, color[0], color[1], color[2])
    gl.uniform1f(u.u_alpha, alpha)
    gl.uniform1f(u.u_rotation, rotation)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.uniform1i(u.u_tex, 0)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
  }

  private drawBeam(from: Vec3, to: Vec3, color: RGB, headProgress: number, alpha: number, viewProj: Float32Array, eye: Vec3): void {
    const gl = this.gl
    const segments = 24
    const verts = new Float32Array(segments * 2 * 5) // pos3, side1, progress1
    let o = 0

    for (let i = 0; i < segments; i++) {
      const t0 = i / (segments - 1)
      const pos: Vec3 = [from[0] + (to[0] - from[0]) * t0, from[1] + (to[1] - from[1]) * t0, from[2] + (to[2] - from[2]) * t0]
      verts.set([pos[0], pos[1], pos[2], -1, t0], o)
      o += 5
      verts.set([pos[0], pos[1], pos[2], 1, t0], o)
      o += 5
    }

    if (verts.length > this.ribbonCapacity) {
      this.ribbonCapacity = verts.length
      gl.bindBuffer(gl.ARRAY_BUFFER, this.ribbonBuffer)
      gl.bufferData(gl.ARRAY_BUFFER, verts, gl.DYNAMIC_DRAW)
    } else {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.ribbonBuffer)
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, verts)
    }

    gl.useProgram(this.ribbonProgram)
    setAttribute(gl, this.ribbonProgram, this.ribbonBuffer, 'a_pos', 3, 20, 0)
    setAttribute(gl, this.ribbonProgram, this.ribbonBuffer, 'a_side', 1, 20, 12)
    setAttribute(gl, this.ribbonProgram, this.ribbonBuffer, 'a_progress', 1, 20, 16)
    const u = uniformLocations(gl, this.ribbonProgram, ['u_viewProj', 'u_cameraPos', 'u_width', 'u_color', 'u_head', 'u_alpha'] as const)
    gl.uniformMatrix4fv(u.u_viewProj, false, viewProj)
    gl.uniform3f(u.u_cameraPos, eye[0], eye[1], eye[2])
    gl.uniform1f(u.u_width, 0.09)
    gl.uniform3f(u.u_color, color[0], color[1], color[2])
    gl.uniform1f(u.u_head, headProgress)
    gl.uniform1f(u.u_alpha, alpha)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, segments * 2)
  }

  render(input: OrbFrameInput): OrbFrameOutput {
    const gl = this.gl
    const { width, height } = this.canvas
    // Fixed pixel-size constants (avatar/ping sizes) are authored in CSS
    // pixels; the canvas backing store is DPR-scaled, so scale them up to
    // match or they read as roughly half-size on any HiDPI display.
    const dpr = width / Math.max(1, this.canvas.clientWidth)
    gl.viewport(0, 0, width, height)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.disable(gl.DEPTH_TEST)

    const t = (input.nowMs - this.startMs) / 1000
    const target = MOOD_TARGETS[input.state]

    const fields: (keyof MoodTarget)[] = ['brightness', 'churn', 'ampBase', 'jagged', 'spinSpeed', 'haloScale', 'ringsActive', 'sizePulse', 'approvalRing']

    for (const field of fields) {
      ;(this.mood as unknown as Record<string, number>)[field] = damp(
        (this.mood as unknown as Record<string, number>)[field],
        target[field] as number,
        MOOD_EASE_RATE,
        input.dt
      )
    }

    const levelTarget = input.reducedMotion ? 0 : clamp(input.rawLevel, 0, 1)
    const levelRate = levelTarget > this.level ? LEVEL_ATTACK_RATE : LEVEL_RELEASE_RATE
    this.level = damp(this.level, levelTarget, levelRate, input.dt)

    // Live speech should visibly energize the orb's churn/spin/glow on top of
    // its resting mood, not just its displacement - ties "how much it's
    // moving" to "how loud the voice is right now" instead of a constant
    // churn that runs at full tilt for the whole state regardless of sound.
    const audioBoost = 1 + this.level * 0.7

    const targetAccent = this.resolveTargetColor(target.colorMode, input.colors, t)
    this.currentAccent = [
      damp(this.currentAccent[0], targetAccent[0], MOOD_EASE_RATE * 1.4, input.dt),
      damp(this.currentAccent[1], targetAccent[1], MOOD_EASE_RATE * 1.4, input.dt),
      damp(this.currentAccent[2], targetAccent[2], MOOD_EASE_RATE * 1.4, input.dt)
    ]
    this.ringActivity = damp(this.ringActivity, target.ringsActive, MOOD_EASE_RATE * 0.8, input.dt)

    const spinMul = input.reducedMotion ? 0.3 : 1
    this.spinAngle += this.mood.spinSpeed * (1 + this.level * 0.55) * 0.22 * spinMul * input.dt

    const breathe = 0.5 + 0.5 * Math.sin(t * 0.6)
    const amp = this.mood.ampBase * (0.75 + 0.25 * breathe) + this.level * 1.05
    const sizeScale = 1 + this.mood.sizePulse * this.level * 0.22 + this.mood.sizePulse * 0.02 * Math.sin(t * 3.0)
    // Glow/line intensity gets a modest live-level lift too - a loud moment
    // should read as "brighter", not just "bigger and busier".
    const brightness = this.mood.brightness * (1 + this.level * 0.12)

    // Camera pulled in from the original 8.5 so the orb (and its halo/rings/
    // constellation, which all key off this same projection) reads noticeably
    // bigger on screen - fills more of the viewport instead of floating small
    // in the middle. Orbit radii top out around 2.6, so this still leaves
    // comfortable clearance before the near plane.
    const eye: Vec3 = [0, 0, 6.4]
    const view = lookAt4(eye, [0, 0, 0], [0, 1, 0])
    const aspect = width / Math.max(1, height)
    const proj = perspective4((42 * Math.PI) / 180, aspect, 0.1, 20)
    const viewProj = multiply4(proj, view)

    const model = composeMat4(rotationY4(this.spinAngle), rotationX4(0.22), scaling4(sizeScale, sizeScale, sizeScale))

    gl.enable(gl.BLEND)

    // --- glow halo shell (drawn first, furthest "back" within this layer) ---
    const centerScreen = projectToScreen(viewProj, [0, 0, 0], width, height, eye)
    const edgeScreen = projectToScreen(viewProj, [HALO_BASE_RADIUS * this.mood.haloScale, 0, 0], width, height, eye)
    const haloPx = Math.abs(edgeScreen.x - centerScreen.x) * 2.1
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE)
    this.drawBillboard(this.glowDotTexture, [centerScreen.x, centerScreen.y], haloPx, this.currentAccent, 0.5 * brightness)

    // --- wireframe orb ---
    gl.useProgram(this.wireframeProgram)
    setAttribute(gl, this.wireframeProgram, this.meshPositions, 'a_pos', 3)

    const wU = uniformLocations(gl, this.wireframeProgram, [
      'u_viewProj', 'u_model', 'u_time', 'u_churn', 'u_amp', 'u_jagged', 'u_cameraPos', 'u_accent', 'u_core', 'u_brightness'
    ] as const)

    gl.uniformMatrix4fv(wU.u_viewProj, false, viewProj)
    gl.uniformMatrix4fv(wU.u_model, false, model)
    gl.uniform1f(wU.u_time, t)
    gl.uniform1f(wU.u_churn, this.mood.churn * audioBoost)
    gl.uniform1f(wU.u_amp, amp)
    gl.uniform1f(wU.u_jagged, this.mood.jagged)
    gl.uniform3f(wU.u_cameraPos, eye[0], eye[1], eye[2])
    gl.uniform3f(wU.u_accent, this.currentAccent[0], this.currentAccent[1], this.currentAccent[2])
    gl.uniform3f(wU.u_core, input.colors.core[0], input.colors.core[1], input.colors.core[2])
    gl.uniform1f(wU.u_brightness, brightness)
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.meshEdgeIndices)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE)
    gl.drawElements(gl.LINES, this.edgeIndexCount, gl.UNSIGNED_SHORT, 0)

    // --- approval rim ring (steady pulse while awaiting approval) ---
    if (this.mood.approvalRing > 0.01) {
      const pulse = 0.6 + 0.4 * Math.sin(t * 2.6)
      this.drawBillboard(this.ringTexture, [centerScreen.x, centerScreen.y], haloPx * 0.92 * pulse, input.colors.approval, this.mood.approvalRing * 0.85)
    }

    // --- Tier 5 helix rings while thinking/toolUse ---
    if (this.ringActivity > 0.01) {
      this.drawHelixRings(viewProj, t)
    }

    // --- constellation: beams, pings, avatars ---
    const activeIds = new Set(input.agents.map(a => a.id))
    this.pruneAvatarTextures(activeIds)
    const labels: LabelPlacement[] = []

    for (const agent of input.agents) {
      const angle = agent.orbitPhase + (input.reducedMotion ? 0 : agent.orbitSpeed * t)
      const local: Vec3 = [agent.orbitRadius * Math.cos(angle), 0, agent.orbitRadius * Math.sin(angle)]
      const tilted = rotateX(local, agent.orbitTilt)
      const worldPos = rotateY(tilted, agent.orbitAzimuth)

      let fx = this.fx.get(agent.id)

      if (!fx) {
        fx = { peakPingSpawned: false }
        this.fx.set(agent.id, fx)
        this.pings.push({ bornAt: input.nowMs, color: agent.color, id: `${agent.id}:orb`, lifespanMs: 850, maxSizePx: 130 * dpr, pos: [0, 0, 0] })
      }

      const arriving = agent.lifecycle === 'arriving'
      const flareT = clamp((input.nowMs - agent.dispatchedAt) / DISPATCH_FLARE_MS, 0, 1)
      const flareEnvelope = arriving ? Math.sin(Math.min(flareT, 1) * Math.PI) : 0

      if (arriving && !fx.peakPingSpawned && flareT >= 0.5) {
        fx.peakPingSpawned = true
        this.pings.push({ bornAt: input.nowMs, color: agent.color, id: `${agent.id}:peak`, lifespanMs: 900, maxSizePx: 170 * dpr, pos: worldPos })
      }

      if (arriving) {
        const headProgress = flareT < 0.5 ? flareT * 2 : (1 - flareT) * 2
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE)
        this.drawBeam([0, 0, 0], worldPos, agent.color, headProgress, 0.85, viewProj, eye)
      }

      const working = agent.lifecycle === 'working'
      const departing = agent.lifecycle === 'departing'
      const fadeOut = departing && agent.completedAt !== null ? 1 - clamp((input.nowMs - agent.completedAt) / FADE_OUT_MS, 0, 1) : 1
      const breath = 0.5 + 0.5 * Math.sin(t * 0.8 + agent.breathPhase)
      const workingPulse = working ? 0.5 + 0.5 * Math.sin(t * 2.3 + agent.breathPhase) : 0
      const flareBoost = 1 + flareEnvelope * 0.9

      const screen = projectToScreen(viewProj, worldPos, width, height, eye)
      const lateral = Math.hypot(worldPos[0], worldPos[1])
      const withinSilhouette = 1 - smoothstep(0.85, 1.7, lateral)
      const behind = smoothstep(0.65, -0.65, worldPos[2])
      const eclipse = withinSilhouette * behind
      const visibility = (1 - eclipse) * fadeOut

      if (screen.visible && visibility > 0.01) {
        const sizePx = AGENT_BASE_SIZE_PX * dpr * (0.85 + 0.15 * breath) * flareBoost * (1 + workingPulse * 0.35)
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE)
        this.drawBillboard(
          this.glowDotTexture,
          [screen.x, screen.y],
          sizePx * (2.1 + workingPulse * 0.6),
          agent.color,
          (0.35 + workingPulse * 0.35) * visibility
        )
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
        this.drawBillboard(this.ensureAvatarTexture(agent), [screen.x, screen.y], sizePx, [1, 1, 1], visibility)

        // Labels are plain DOM, positioned in CSS pixels - the canvas's own
        // width/height above are the (possibly DPR-scaled) backing-store size
        // used for WebGL, so screen.x/y must be rescaled back to CSS pixels.
        labels.push({
          color: agent.color,
          depth: worldPos[2],
          detail: agent.detail,
          id: agent.id,
          name: agent.name,
          opacity: visibility,
          scale: 0.85 + 0.15 * screen.facing,
          x: screen.x * (this.canvas.clientWidth / width),
          y: screen.y * (this.canvas.clientHeight / height)
        })
      }
    }

    // occasional faint pulse wave rippling outward while thinking
    if (this.ringActivity > 0.4 && input.nowMs - this.lastWaveAt > 2600) {
      this.lastWaveAt = input.nowMs
      this.pings.push({ bornAt: input.nowMs, color: this.currentAccent, id: `wave:${input.nowMs}`, lifespanMs: 1600, maxSizePx: 320 * dpr, pos: [0, 0, 0] })
    }

    gl.blendFunc(gl.SRC_ALPHA, gl.ONE)
    this.pings = this.pings.filter(ping => input.nowMs - ping.bornAt < ping.lifespanMs)

    for (const ping of this.pings) {
      const age = clamp((input.nowMs - ping.bornAt) / ping.lifespanMs, 0, 1)
      const screen = projectToScreen(viewProj, ping.pos, width, height, eye)

      if (!screen.visible) {
        continue
      }

      const size = 14 * dpr + age * ping.maxSizePx
      const alpha = (1 - age) * 0.75
      this.drawBillboard(this.ringTexture, [screen.x, screen.y], size, ping.color, alpha)
    }

    labels.sort((a, b) => a.depth - b.depth)

    return { labels, orbBrightness: brightness, orbColor: this.currentAccent }
  }

  private resolveTargetColor(mode: MoodTarget['colorMode'], colors: OrbColorPalette, t: number): RGB {
    switch (mode) {
      case 'amber':
        return colors.amber

      case 'approval':
        return colors.approval

      case 'error':
        return colors.error
      case 'cycle': {
        const mixT = 0.5 + 0.5 * Math.sin(t * 0.3)

        return mixColor(colors.ring, HELIX_PURPLE, mixT)
      }

      case 'cycleTool': {
        const mixT = 0.5 + 0.5 * Math.sin(t * 0.22)

        return mixColor(colors.ring, colors.particle, mixT)
      }

      case 'accent':

      default:
        return colors.ring
    }
  }

  private drawHelixRings(viewProj: Float32Array, t: number): void {
    const gl = this.gl
    gl.useProgram(this.ringProgram)
    setAttribute(gl, this.ringProgram, this.ringUnitBuffer, 'a_dir', 2, 12, 0)
    setAttribute(gl, this.ringProgram, this.ringUnitBuffer, 'a_side', 1, 12, 8)
    const u = uniformLocations(gl, this.ringProgram, ['u_viewProj', 'u_model', 'u_pulsePhase', 'u_color', 'u_alpha', 'u_width'] as const)
    gl.uniformMatrix4fv(u.u_viewProj, false, viewProj)
    gl.uniform1f(u.u_width, 0.014)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE)

    for (let i = 0; i < RING_COUNT; i++) {
      const radius = 1.14 + i * 0.13
      const tilt = 0.5 + i * 0.42 + (i % 2 === 0 ? 0 : -0.3)
      const spin = t * (0.35 + i * 0.12) * (i % 2 === 0 ? 1 : -1)
      const model = composeMat4(rotationY4(spin), rotationX4(tilt), scaling4(radius, radius, radius))
      const hueT = 0.5 + 0.5 * Math.sin(t * 0.2 + i * 1.3)
      const color = mixColor(HELIX_TEAL, HELIX_PURPLE, hueT)
      gl.uniformMatrix4fv(u.u_model, false, model)
      gl.uniform1f(u.u_pulsePhase, t * (1.4 + i * 0.3))
      gl.uniform3f(u.u_color, color[0], color[1], color[2])
      gl.uniform1f(u.u_alpha, this.ringActivity * 1.1)
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, this.ringVertexCount)
    }
  }

  dispose(): void {
    const gl = this.gl
    gl.deleteProgram(this.wireframeProgram)
    gl.deleteProgram(this.billboardProgram)
    gl.deleteProgram(this.ribbonProgram)
    gl.deleteProgram(this.ringProgram)
    gl.deleteBuffer(this.meshPositions)
    gl.deleteBuffer(this.meshEdgeIndices)
    gl.deleteBuffer(this.quadBuffer)
    gl.deleteBuffer(this.ringUnitBuffer)
    gl.deleteBuffer(this.ribbonBuffer)
    gl.deleteTexture(this.glowDotTexture)
    gl.deleteTexture(this.ringTexture)

    for (const entry of this.avatarTextures.values()) {
      gl.deleteTexture(entry.tex)
    }

    this.avatarTextures.clear()
  }
}
