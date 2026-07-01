import { compileShader, createFloatBuffer, resizeCanvasToDisplaySize, setAttribute, uniformLocations } from './gl-utils'
import { lookAt4, multiply4, perspective4, type Vec3 } from './math'
import { NOISE_GLSL } from './noise-glsl'

const SKY_VERT = /* glsl */ `#version 300 es
in vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
`

const SKY_FRAG = /* glsl */ `#version 300 es
precision highp float;
uniform vec2 u_res;
uniform float u_time;
uniform float u_intro;
uniform vec3 u_orbColor;
uniform float u_orbBrightness;
out vec4 fragColor;
${NOISE_GLSL}
mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }

void main() {
  vec2 uv = (gl_FragCoord.xy * 2.0 - u_res) / min(u_res.x, u_res.y);
  float r = length(uv);

  vec3 base = mix(vec3(0.012, 0.016, 0.03), vec3(0.002, 0.004, 0.012), smoothstep(0.0, 1.3, r));

  vec2 driftA = uv * 1.05 + vec2(u_time * 0.016, -u_time * 0.010);
  vec2 driftB = rot(0.9) * uv * 1.4 + vec2(-u_time * 0.012, u_time * 0.017);
  vec2 driftC = rot(-0.5) * uv * 0.85 + vec2(u_time * 0.009, u_time * 0.013);

  float nebA = smoothstep(0.42, 0.86, fbm3(vec3(driftA, u_time * 0.02)));
  float nebB = smoothstep(0.5, 0.9, fbm3(vec3(driftB, 5.0 - u_time * 0.017)));
  float nebC = smoothstep(0.46, 0.88, fbm3(vec3(driftC, 11.0 + u_time * 0.014)));

  vec3 color = base;
  color += vec3(0.09, 0.42, 0.38) * nebA * 0.5;
  color += vec3(0.32, 0.12, 0.4) * nebB * 0.34;
  color += vec3(0.1, 0.22, 0.5) * nebC * 0.4;

  float starsFine = 0.0;
  {
    vec2 grid = uv * 190.0 + 4.0;
    vec2 id = floor(grid);
    vec2 cell = fract(grid) - 0.5;
    float rnd = hash12(id);
    float star = step(0.986, rnd);
    float twinkle = 0.5 + 0.5 * sin(u_time * (0.7 + hash12(id + 3.1) * 2.2) + rnd * 6.28318);
    starsFine = star * smoothstep(0.05, 0.0, length(cell)) * twinkle;
  }

  float starsCoarse = 0.0;
  {
    vec2 grid = uv * 68.0 + 31.0;
    vec2 id = floor(grid);
    vec2 cell = fract(grid) - 0.5;
    float rnd = hash12(id + 9.0);
    float star = step(0.965, rnd);
    float twinkle = 0.55 + 0.45 * sin(u_time * (0.4 + hash12(id + 17.0) * 1.4) + rnd * 6.28318);
    starsCoarse = star * smoothstep(0.09, 0.0, length(cell)) * twinkle;
  }

  color += vec3(0.72, 0.82, 1.0) * starsFine * 0.8;
  color += vec3(0.75, 0.85, 1.0) * starsCoarse * 1.05;

  // Same wide-aspect problem as the vignette below: r=1 used to sit at the
  // edge of a small square/circular crop, so a steep falloff still read as a
  // full glowing orb. On a full-viewport canvas the same falloff collapses to
  // a tiny hot spot lost in a mostly-black frame. Widened so the glow stays
  // visible out to roughly where the vignette starts, instead of fading to
  // nothing well before it.
  float glowPool = exp(-r * r * 0.75) * u_orbBrightness;
  color += u_orbColor * glowPool * 0.7;

  // r is normalized by min(width,height), so on a wide full-viewport canvas
  // the left/right edges sit well past r=1 (up to ~1.9 in the corners). The
  // thresholds below are tuned for that wide-aspect range so the vignette
  // only bites near the true corners instead of crushing the outer thirds of
  // the screen to black on anything wider than a roughly square crop.
  float vignette = 1.0 - smoothstep(1.3, 2.1, r) * 0.42;
  color *= vignette;
  color *= clamp(u_intro, 0.0, 1.0);

  fragColor = vec4(color, 1.0);
}
`

const FIELD_VERT = /* glsl */ `#version 300 es
in vec3 a_pos;
in vec3 a_color;
in float a_size;
in float a_flag;
uniform mat4 u_viewProj;
uniform mat4 u_spin;
uniform float u_projScale;
uniform float u_time;
uniform float u_intro;
out vec3 v_color;
out float v_alpha;
out float v_isDust;

void main() {
  vec4 spun = u_spin * vec4(a_pos, 1.0);
  vec3 pos = spun.xyz;

  if (a_flag > 0.5) {
    float seed = a_size * 71.0 + a_color.r * 37.0;
    pos += vec3(
      sin(u_time * 0.05 + seed) * 0.35,
      cos(u_time * 0.04 + seed * 1.3) * 0.3,
      sin(u_time * 0.035 + seed * 0.7) * 0.35
    );
  }

  vec4 clip = u_viewProj * vec4(pos, 1.0);
  gl_Position = clip;
  gl_PointSize = clamp(a_size * u_projScale / clip.w, 1.0, 40.0);
  v_color = a_color;
  v_isDust = a_flag;
  v_alpha = clamp(u_intro, 0.0, 1.0);
}
`

const FIELD_FRAG = /* glsl */ `#version 300 es
precision highp float;
in vec3 v_color;
in float v_alpha;
in float v_isDust;
out vec4 fragColor;

void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float d = dot(c, c);
  float falloff = exp(-d * 3.4);
  float dim = mix(1.0, 0.4, v_isDust);
  fragColor = vec4(v_color * falloff * dim * v_alpha, 1.0);
}
`

const LINE_VERT = /* glsl */ `#version 300 es
in vec3 a_pos;
in vec3 a_color;
uniform mat4 u_viewProj;
uniform mat4 u_spin;
uniform float u_intro;
out vec3 v_color;
out float v_alpha;

void main() {
  vec4 spun = u_spin * vec4(a_pos, 1.0);
  gl_Position = u_viewProj * spun;
  v_color = a_color;
  v_alpha = clamp(u_intro, 0.0, 1.0);
}
`

const LINE_FRAG = /* glsl */ `#version 300 es
precision highp float;
in vec3 v_color;
in float v_alpha;
out vec4 fragColor;
void main() { fragColor = vec4(v_color * 0.5 * v_alpha, 1.0); }
`

const CLUSTER_COUNT = 8
const NODES_PER_CLUSTER_DESKTOP = 13
const NODES_PER_CLUSTER_MOBILE = 7
const DUST_COUNT_DESKTOP = 260
const DUST_COUNT_MOBILE = 130
const LINK_DISTANCE = 1.35

function seededRandom(seed: number): () => number {
  let state = seed >>> 0

  return () => {
    state = (state * 1664525 + 1013904223) >>> 0

    return state / 4294967296
  }
}

function buildField(lowSpec: boolean, palette: ReadonlyArray<[number, number, number]>) {
  const rand = seededRandom(20260701)
  const nodesPerCluster = lowSpec ? NODES_PER_CLUSTER_MOBILE : NODES_PER_CLUSTER_DESKTOP
  const dustCount = lowSpec ? DUST_COUNT_MOBILE : DUST_COUNT_DESKTOP

  const nodePositions: Vec3[] = []
  const nodeColors: [number, number, number][] = []

  for (let c = 0; c < CLUSTER_COUNT; c++) {
    const theta = rand() * Math.PI * 2
    const phi = Math.acos(1 - 2 * rand())
    const clusterRadius = 4.6 + rand() * 3.4
    const cx = clusterRadius * Math.sin(phi) * Math.cos(theta)
    const cy = clusterRadius * Math.cos(phi) * 0.72
    const cz = clusterRadius * Math.sin(phi) * Math.sin(theta) - 1.5
    const color = palette[c % palette.length]!

    for (let n = 0; n < nodesPerCluster; n++) {
      const spread = 0.55 + rand() * 0.5
      nodePositions.push([cx + (rand() - 0.5) * spread, cy + (rand() - 0.5) * spread, cz + (rand() - 0.5) * spread])
      nodeColors.push(color)
    }
  }

  const edges: [number, number][] = []

  for (let i = 0; i < nodePositions.length; i++) {
    for (let j = i + 1; j < nodePositions.length; j++) {
      const a = nodePositions[i]!
      const b = nodePositions[j]!
      const dx = a[0] - b[0]
      const dy = a[1] - b[1]
      const dz = a[2] - b[2]
      const distSq = dx * dx + dy * dy + dz * dz

      if (distSq < LINK_DISTANCE * LINK_DISTANCE) {
        edges.push([i, j])
      }
    }
  }

  const dustPositions: Vec3[] = []

  for (let i = 0; i < dustCount; i++) {
    const theta = rand() * Math.PI * 2
    const phi = Math.acos(1 - 2 * rand())
    const radius = 2.5 + rand() * 7
    dustPositions.push([
      radius * Math.sin(phi) * Math.cos(theta),
      radius * Math.cos(phi) * 0.8,
      radius * Math.sin(phi) * Math.sin(theta) - 1.5
    ])
  }

  const pointCount = nodePositions.length + dustPositions.length
  const pointBuffer = new Float32Array(pointCount * 8) // pos3, color3, size1, flag1
  let o = 0

  nodePositions.forEach((p, i) => {
    const color = nodeColors[i]!
    pointBuffer.set([p[0], p[1], p[2], color[0], color[1], color[2], 2.4, 0], o)
    o += 8
  })

  dustPositions.forEach(p => {
    pointBuffer.set([p[0], p[1], p[2], 0.75, 0.82, 0.95, 1.1, 1], o)
    o += 8
  })

  const lineBuffer = new Float32Array(edges.length * 2 * 6) // 2 verts * (pos3+color3)
  let lo = 0

  for (const [i, j] of edges) {
    const a = nodePositions[i]!
    const b = nodePositions[j]!
    const ca = nodeColors[i]!
    lineBuffer.set([a[0], a[1], a[2], ca[0], ca[1], ca[2], b[0], b[1], b[2], ca[0], ca[1], ca[2]], lo)
    lo += 12
  }

  return { lineBuffer, pointBuffer, pointCount }
}

export interface BackgroundFrameInput {
  time: number
  orbColor: [number, number, number]
  orbBrightness: number
  reducedMotion: boolean
}

/**
 * The furthest-back layer: procedural sky (nebula/stars/vignette/glow-pool)
 * plus a faint distant node-web and dust, on its own canvas/context so it can
 * be throttled independently of the orb layer (performance mode renders it
 * at half resolution, every other frame).
 */
export class OrbBackgroundLayer {
  private gl: WebGL2RenderingContext
  private skyProgram: WebGLProgram
  private fieldProgram: WebGLProgram
  private lineProgram: WebGLProgram
  private quadBuffer: WebGLBuffer
  private pointBuffer: WebGLBuffer
  private lineBuffer: WebGLBuffer
  private pointCount: number
  private lineVertexCount: number
  private intro = 0
  private introRate = 1 / 1.5
  private driftSeed = Math.random() * 1000
  private disposed = false

  constructor(
    private canvas: HTMLCanvasElement,
    lowSpec: boolean
  ) {
    const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, powerPreference: 'low-power' })

    if (!gl) {
      throw new Error('[jarvis-orb] background: WebGL2 unavailable')
    }

    this.gl = gl
    this.skyProgram = (() => {
      const vs = compileShader(gl, gl.VERTEX_SHADER, SKY_VERT)
      const fs = compileShader(gl, gl.FRAGMENT_SHADER, SKY_FRAG)
      const p = gl.createProgram()!
      gl.attachShader(p, vs)
      gl.attachShader(p, fs)
      gl.linkProgram(p)

      return p
    })()
    this.fieldProgram = (() => {
      const vs = compileShader(gl, gl.VERTEX_SHADER, FIELD_VERT)
      const fs = compileShader(gl, gl.FRAGMENT_SHADER, FIELD_FRAG)
      const p = gl.createProgram()!
      gl.attachShader(p, vs)
      gl.attachShader(p, fs)
      gl.linkProgram(p)

      return p
    })()
    this.lineProgram = (() => {
      const vs = compileShader(gl, gl.VERTEX_SHADER, LINE_VERT)
      const fs = compileShader(gl, gl.FRAGMENT_SHADER, LINE_FRAG)
      const p = gl.createProgram()!
      gl.attachShader(p, vs)
      gl.attachShader(p, fs)
      gl.linkProgram(p)

      return p
    })()

    this.quadBuffer = createFloatBuffer(gl, new Float32Array([-1, -1, 3, -1, -1, 3]))

    const palette: ReadonlyArray<[number, number, number]> = [
      [0.1, 0.78, 0.66],
      [0.2, 0.75, 0.95],
      [0.3, 0.55, 0.98],
      [0.35, 0.45, 0.95],
      [0.48, 0.42, 0.95],
      [0.62, 0.4, 0.95],
      [0.78, 0.35, 0.85],
      [0.25, 0.85, 0.55]
    ]

    const field = buildField(lowSpec, palette)
    this.pointBuffer = createFloatBuffer(gl, field.pointBuffer)
    this.pointCount = field.pointCount
    this.lineBuffer = createFloatBuffer(gl, field.lineBuffer)
    this.lineVertexCount = field.lineBuffer.length / 6
  }

  resize(scale: number): void {
    resizeCanvasToDisplaySize(this.canvas, 2, scale)
  }

  render(input: BackgroundFrameInput): void {
    if (this.disposed) {
      return
    }

    const gl = this.gl
    const { width, height } = this.canvas
    gl.viewport(0, 0, width, height)

    this.intro = Math.min(1, this.intro + this.introRate * (1 / 60))

    gl.disable(gl.DEPTH_TEST)
    gl.disable(gl.BLEND)
    gl.useProgram(this.skyProgram)
    setAttribute(gl, this.skyProgram, this.quadBuffer, 'a_pos', 2)

    const skyU = uniformLocations(gl, this.skyProgram, [
      'u_res',
      'u_time',
      'u_intro',
      'u_orbColor',
      'u_orbBrightness'
    ] as const)

    gl.uniform2f(skyU.u_res, width, height)
    gl.uniform1f(skyU.u_time, input.time)
    gl.uniform1f(skyU.u_intro, this.intro)
    gl.uniform3f(skyU.u_orbColor, input.orbColor[0], input.orbColor[1], input.orbColor[2])
    gl.uniform1f(skyU.u_orbBrightness, input.orbBrightness)
    gl.drawArrays(gl.TRIANGLES, 0, 3)

    const aspect = width / Math.max(1, height)
    const driftT = input.reducedMotion ? 0 : input.time

    const eye: Vec3 = [
      Math.sin(driftT * 0.02 + this.driftSeed) * 0.35,
      Math.cos(driftT * 0.017 + this.driftSeed) * 0.22,
      7.2
    ]

    const view = lookAt4(eye, [0, 0, -1.5], [0, 1, 0])
    const proj = perspective4((42 * Math.PI) / 180, aspect, 0.1, 40)
    const viewProj = multiply4(proj, view)
    const spinAngle = input.reducedMotion ? 0.4 : input.time * 0.012
    const c = Math.cos(spinAngle)
    const s = Math.sin(spinAngle)

    // prettier-ignore
    const spin = new Float32Array([
      c, 0, -s, 0,
      0, 1, 0, 0,
      s, 0, c, 0,
      0, 0, 0, 1
    ])

    const projScale = height / (2 * Math.tan((42 * Math.PI) / 180 / 2))

    gl.enable(gl.BLEND)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE)

    gl.useProgram(this.lineProgram)
    setAttribute(gl, this.lineProgram, this.lineBuffer, 'a_pos', 3, 24, 0)
    setAttribute(gl, this.lineProgram, this.lineBuffer, 'a_color', 3, 24, 12)
    const lineU = uniformLocations(gl, this.lineProgram, ['u_viewProj', 'u_spin', 'u_intro'] as const)
    gl.uniformMatrix4fv(lineU.u_viewProj, false, viewProj)
    gl.uniformMatrix4fv(lineU.u_spin, false, spin)
    gl.uniform1f(lineU.u_intro, this.intro * 0.5)
    gl.drawArrays(gl.LINES, 0, this.lineVertexCount)

    gl.useProgram(this.fieldProgram)
    setAttribute(gl, this.fieldProgram, this.pointBuffer, 'a_pos', 3, 32, 0)
    setAttribute(gl, this.fieldProgram, this.pointBuffer, 'a_color', 3, 32, 12)
    setAttribute(gl, this.fieldProgram, this.pointBuffer, 'a_size', 1, 32, 24)
    setAttribute(gl, this.fieldProgram, this.pointBuffer, 'a_flag', 1, 32, 28)

    const fieldU = uniformLocations(gl, this.fieldProgram, [
      'u_viewProj',
      'u_spin',
      'u_projScale',
      'u_time',
      'u_intro'
    ] as const)

    gl.uniformMatrix4fv(fieldU.u_viewProj, false, viewProj)
    gl.uniformMatrix4fv(fieldU.u_spin, false, spin)
    gl.uniform1f(fieldU.u_projScale, projScale)
    gl.uniform1f(fieldU.u_time, input.reducedMotion ? 0 : input.time)
    gl.uniform1f(fieldU.u_intro, this.intro * 0.85)
    gl.drawArrays(gl.POINTS, 0, this.pointCount)
  }

  dispose(): void {
    this.disposed = true
    const gl = this.gl
    gl.deleteProgram(this.skyProgram)
    gl.deleteProgram(this.fieldProgram)
    gl.deleteProgram(this.lineProgram)
    gl.deleteBuffer(this.quadBuffer)
    gl.deleteBuffer(this.pointBuffer)
    gl.deleteBuffer(this.lineBuffer)
  }
}
