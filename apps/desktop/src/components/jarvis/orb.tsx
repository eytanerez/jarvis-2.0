import { useEffect, useRef } from 'react'

import { cn } from '@/lib/utils'

// The seven cockpit states the orb can portray. Driven by real gateway/audio
// state upstream (see store/jarvis-cockpit); this component only paints.
export type OrbState =
  | 'awaitingApproval'
  | 'error'
  | 'idle'
  | 'listening'
  | 'speaking'
  | 'thinking'
  | 'toolUse'

export interface JarvisOrbProps {
  className?: string
  /**
   * Per-frame level sampler returning 0-1 for the given state. Preferred over
   * the numeric props: it lets the parent feed live mic/TTS levels without
   * pushing audio through React state at frame rate. Falls back to the props.
   */
  getLevel?: (state: OrbState) => number
  /** Smoothed mic level, 0-1 (from use-mic-recorder). Fallback for `getLevel`. */
  listeningLevel?: number
  reducedMotion?: boolean
  /** Smoothed assistant-speech level, 0-1 (TTS analyser). Fallback for `getLevel`. */
  speakingLevel?: number
  state: OrbState
}

const STATE_CODE: Record<OrbState, number> = {
  awaitingApproval: 5,
  error: 6,
  idle: 0,
  listening: 1,
  speaking: 3,
  thinking: 2,
  toolUse: 4
}

// Color tokens read off the theme (see styles.css). Kept as vars so a skin
// change re-tints the orb; parsed via getComputedStyle at runtime.
const COLOR_VARS = [
  '--theme-orb-core',
  '--theme-orb-glow',
  '--theme-orb-ring',
  '--theme-orb-particle',
  '--theme-orb-error',
  '--theme-orb-approval',
  '--theme-jarvis-bg',
  '--theme-jarvis-bg-deep'
] as const

const VERT = `#version 300 es
in vec2 p;
void main(){ gl_Position = vec4(p, 0.0, 1.0); }`

// Ported verbatim from the locked preview shader. Screen-space volumetric orb:
// a soft-edged sphere with fresnel rim, fbm plasma veins, orbiting particles,
// and additive bloom, tone-mapped over a night backdrop.
const FRAG = `#version 300 es
precision highp float;
out vec4 fragColor;
uniform vec2 u_res; uniform float u_time; uniform float u_level; uniform float u_state;
uniform float u_reduced; uniform float u_error; uniform float u_intro;
uniform vec3 u_core; uniform vec3 u_glow; uniform vec3 u_ring; uniform vec3 u_particle;
uniform vec3 u_errCol; uniform vec3 u_appCol; uniform vec3 u_bg; uniform vec3 u_bgDeep;

float hash(vec3 p){ p=fract(p*0.3183099+0.1); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float noise(vec3 x){ vec3 i=floor(x); vec3 f=fract(x); f=f*f*(3.0-2.0*f);
  return mix(mix(mix(hash(i+vec3(0,0,0)),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z); }
float fbm(vec3 p){ float a=0.5,s=0.0; for(int i=0;i<5;i++){ s+=a*noise(p); p*=2.02; a*=0.5; } return s; }
mat2 rot(float a){ float c=cos(a),s=sin(a); return mat2(c,-s,s,c); }

void main(){
  vec2 uv=(gl_FragCoord.xy*2.0-u_res)/min(u_res.x,u_res.y);
  float r=length(uv); float ang=atan(uv.y,uv.x);
  float t = u_reduced>0.5 ? 6.0 : u_time;
  float st=u_state; float lvl=clamp(u_level,0.0,1.0);
  float breathe = 0.5+0.5*sin(t*0.7);
  float baseR=0.50; float scale=1.0;
  scale += (u_reduced>0.5?0.0:0.03*breathe);
  scale += 0.12*lvl*step(0.5,st);
  float R=baseR*scale;
  float rr=r/R; float z=sqrt(max(0.0,1.0-rr*rr)); vec3 nrm=vec3(uv/R,z);

  float turbAmp=0.4+0.6*lvl; vec3 spp=nrm*2.1; spp.xy*=rot(t*0.16);
  float turb=fbm(spp+vec3(0.0,0.0,t*0.28)); turb=mix(0.6,turb,turbAmp);

  float disk=smoothstep(1.02,0.90,rr);
  float depth=smoothstep(1.05,0.0,rr);
  float body=disk;
  float coreHot=pow(depth,2.3);
  float fres=pow(1.0-z,2.3)*smoothstep(1.16,0.84,rr);
  float glow=pow(R/max(r,1e-3),1.7)*0.09;
  float halo=exp(-max(0.0,(rr-1.0))*4.0);
  float bloom=exp(-r*r*1.8);

  float veins = smoothstep(0.42,0.95,turb);
  vec3 col=vec3(0.0);
  col += u_glow * disk    * (0.42+0.55*turb) * (0.6+0.85*depth) * 1.55;
  col += u_ring * disk    * veins * depth * 0.9;
  col += u_core * coreHot * (0.9+0.5*turb) * 1.5;
  col += vec3(1.0) * pow(depth,6.5) * 0.4;
  col += u_ring * fres   * 1.9;
  col += u_glow * glow   * 1.0;
  col += u_ring * halo   * 0.7;
  col += u_glow * bloom  * 0.4;

  if(st>1.5&&st<2.5){ float sweep=pow(0.5+0.5*cos(ang-t*1.6),6.0); col+=u_ring*sweep*(fres+0.3*body)*2.2; }

  if((st>1.5&&st<2.5)||(st>3.5&&st<4.5)){
    float pr=R*1.34; float s2=(st>3.5?1.5:0.95);
    for(int i=0;i<10;i++){ float a=t*s2+float(i)*0.6283185; vec2 pp=rot(0.6)*(vec2(cos(a),sin(a)*0.5)*pr);
      float d=length(uv-pp); col+=u_particle*exp(-d*d*260.0)*1.5; }
  }

  if(st>4.5&&st<5.5){ float ringD=abs(rr-1.16); float thin=exp(-ringD*ringD*700.0);
    float pulse=0.62+0.38*sin(t*2.4); col+=u_appCol*thin*(1.5*pulse); }

  if(st>2.5&&st<3.5){ col+=u_core*coreHot*lvl*0.7; col+=u_glow*body*lvl*0.4; }

  col=mix(col,u_errCol*(disk*1.1+fres*1.3+halo*0.35)*1.5,clamp(u_error,0.0,1.0));

  float energy=0.82;
  if(st>0.5&&st<1.5) energy=0.85+0.45*lvl;
  if(st>1.5&&st<2.5) energy=0.96;
  if(st>2.5&&st<3.5) energy=0.9+0.5*lvl;
  if(st>3.5&&st<4.5) energy=0.96;
  if(st>4.5&&st<5.5) energy=0.84;
  col*=energy;

  col*=smoothstep(1.9,0.15,r);
  vec3 bg=mix(u_bgDeep,u_bg,smoothstep(1.6,0.0,r)); bg+=u_glow*0.04*smoothstep(1.3,0.0,r);
  float star=step(0.9993,hash(floor(vec3(uv*160.0,1.0)))); bg+=vec3(0.5,0.6,0.85)*star*0.6;
  col=bg+col;

  col=1.0-exp(-col*1.15);
  col*=clamp(u_intro,0.0,1.0);
  fragColor=vec4(col,1.0);
}`

type RGB = [number, number, number]

function readColor(host: HTMLElement, varName: string): RGB {
  const probe = document.createElement('span')
  probe.style.color = getComputedStyle(host).getPropertyValue(varName)
  host.appendChild(probe)
  const resolved = getComputedStyle(probe).color
  probe.remove()
  const nums = (resolved.match(/[\d.]+/g) ?? ['0', '0', '0']).map(Number)

  // color-mix() resolves to `color(srgb r g b)` with 0-1 channels; hex/named
  // resolve to `rgb(r g b)` with 0-255. Normalize both to 0-1.
  return resolved.startsWith('color(')
    ? [nums[0], nums[1], nums[2]]
    : [nums[0] / 255, nums[1] / 255, nums[2] / 255]
}

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader | null {
  const shader = gl.createShader(type)

  if (!shader) {
    return null
  }

  gl.shaderSource(shader, src)
  gl.compileShader(shader)

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error('[JarvisOrb] shader compile failed:', gl.getShaderInfoLog(shader))
    gl.deleteShader(shader)

    return null
  }

  return shader
}

/**
 * Audio-reactive J.A.R.V.I.S orb, rendered with a single WebGL2 fragment
 * shader (no 3D library, no new deps). Levels and state are fed as props; all
 * per-frame motion runs in the render loop off refs; React state is never
 * written at frame rate. Respects `prefers-reduced-motion`.
 */
export function JarvisOrb({
  className,
  getLevel,
  listeningLevel = 0,
  reducedMotion = false,
  speakingLevel = 0,
  state
}: JarvisOrbProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  // Latest prop values, read inside the RAF loop without re-subscribing it.
  const propsRef = useRef({ getLevel, listeningLevel, reducedMotion, speakingLevel, state })
  propsRef.current = { getLevel, listeningLevel, reducedMotion, speakingLevel, state }

  useEffect(() => {
    const canvas = canvasRef.current

    if (!canvas) {
      return
    }

    const gl = canvas.getContext('webgl2', { alpha: false, antialias: true, premultipliedAlpha: false })

    if (!gl) {
      console.error('[JarvisOrb] WebGL2 unavailable')

      return
    }

    const vs = compile(gl, gl.VERTEX_SHADER, VERT)
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG)

    if (!vs || !fs) {
      return
    }

    const program = gl.createProgram()
    gl.attachShader(program, vs)
    gl.attachShader(program, fs)
    gl.linkProgram(program)

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error('[JarvisOrb] program link failed:', gl.getProgramInfoLog(program))

      return
    }

    gl.useProgram(program)

    const buffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    const loc = gl.getAttribLocation(program, 'p')
    gl.enableVertexAttribArray(loc)
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)

    const u = (name: string) => gl.getUniformLocation(program, name)
    const uRes = u('u_res')
    const uTime = u('u_time')
    const uLevel = u('u_level')
    const uState = u('u_state')
    const uReduced = u('u_reduced')
    const uError = u('u_error')
    const uIntro = u('u_intro')

    // Color uniforms track the active skin. Read now; re-read on theme change.
    const host = canvas.parentElement ?? document.body

    const applyColors = () => {
      const [core, glow, ring, particle, errCol, appCol, bg, bgDeep] = COLOR_VARS.map(v => readColor(host, v))
      gl.uniform3fv(u('u_core'), core)
      gl.uniform3fv(u('u_glow'), glow)
      gl.uniform3fv(u('u_ring'), ring)
      gl.uniform3fv(u('u_particle'), particle)
      gl.uniform3fv(u('u_errCol'), errCol)
      gl.uniform3fv(u('u_appCol'), appCol)
      gl.uniform3fv(u('u_bg'), bg)
      gl.uniform3fv(u('u_bgDeep'), bgDeep)
    }

    applyColors()

    // Skin changes flip the .dark class / inline theme vars on <html>.
    const themeObserver = new MutationObserver(applyColors)
    themeObserver.observe(document.documentElement, { attributeFilter: ['class', 'style'], attributes: true })

    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      const w = Math.max(1, Math.round(canvas.clientWidth * dpr))
      const h = Math.max(1, Math.round(canvas.clientHeight * dpr))

      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w
        canvas.height = h
      }
    }

    const resizeObserver = new ResizeObserver(resize)
    resizeObserver.observe(canvas)
    resize()

    let raf = 0
    const start = performance.now()
    let level = 0
    let errEnv = 0
    let intro = reducedMotion ? 1 : 0
    let prevState = state

    const frame = (now: number) => {
      const p = propsRef.current
      const time = (now - start) / 1000

      // Smooth the audio level toward its target (no nervous flicker). Reduced
      // motion holds the orb steady; feedback stays as color/energy, not scale.
      const sampled = p.getLevel
        ? p.getLevel(p.state)
        : p.state === 'listening'
          ? p.listeningLevel
          : p.state === 'speaking'
            ? p.speakingLevel
            : 0

      const target = p.reducedMotion ? 0 : sampled
      level += (Math.max(0, Math.min(1, target)) - level) * 0.15

      // Error: a tight pulse on entry that settles to a low steady red.
      if (p.state === 'error' && prevState !== 'error') {
        errEnv = 1
      }

      prevState = p.state
      const errTarget = p.state === 'error' ? Math.max(0.4, errEnv) : 0
      errEnv *= 0.94
      // Snap-decay the visible envelope toward target so leaving error clears it.
      const uErr = p.state === 'error' ? errTarget : 0

      intro += (1 - intro) * (p.reducedMotion ? 1 : 0.05)

      gl.uniform2f(uRes, canvas.width, canvas.height)
      gl.uniform1f(uTime, time)
      gl.uniform1f(uLevel, level)
      gl.uniform1f(uState, STATE_CODE[p.state])
      gl.uniform1f(uReduced, p.reducedMotion ? 1 : 0)
      gl.uniform1f(uError, uErr)
      gl.uniform1f(uIntro, intro)
      gl.viewport(0, 0, canvas.width, canvas.height)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
      raf = requestAnimationFrame(frame)
    }

    raf = requestAnimationFrame(frame)

    return () => {
      cancelAnimationFrame(raf)
      themeObserver.disconnect()
      resizeObserver.disconnect()
      gl.deleteBuffer(buffer)
      gl.deleteProgram(program)
      gl.deleteShader(vs)
      gl.deleteShader(fs)
    }
    // Mount once; live values flow through propsRef.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className={cn('jarvis-stage relative isolate overflow-hidden', className)}>
      <canvas aria-hidden="true" className="block size-full" ref={canvasRef} />
    </div>
  )
}
