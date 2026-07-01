import { useEffect, useRef } from 'react'

import { cn } from '@/lib/utils'

// The seven cockpit states the orb can portray. Driven by real gateway/audio
// state upstream (see store/jarvis-cockpit); this component only paints.
export type OrbState = 'awaitingApproval' | 'error' | 'idle' | 'listening' | 'speaking' | 'thinking' | 'toolUse'

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

// Voice-first electric-blue orb scene. The pasted Trillion prompt maps onto our
// existing WebGL2 path: u_level is the voice-bright input, and u_state keeps the
// seven Jarvis cockpit states distinct without adding a dependency.
const FRAG = `#version 300 es
precision highp float;
out vec4 fragColor;
uniform vec2 u_res; uniform float u_time; uniform float u_level; uniform float u_state;
uniform float u_reduced; uniform float u_error; uniform float u_intro;
uniform vec3 u_core; uniform vec3 u_glow; uniform vec3 u_ring; uniform vec3 u_particle;
uniform vec3 u_errCol; uniform vec3 u_appCol; uniform vec3 u_bg; uniform vec3 u_bgDeep;

float hash(vec3 p){ p=fract(p*0.3183099+0.1); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float hash21(vec2 p){ vec3 p3=fract(vec3(p.xyx)*0.1031); p3+=dot(p3,p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
float noise(vec3 x){ vec3 i=floor(x); vec3 f=fract(x); f=f*f*(3.0-2.0*f);
  return mix(mix(mix(hash(i+vec3(0,0,0)),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z); }
float fbm(vec3 p){ float a=0.5,s=0.0; for(int i=0;i<5;i++){ s+=a*noise(p); p*=2.02; a*=0.5; } return s; }
mat2 rot(float a){ float c=cos(a),s=sin(a); return mat2(c,-s,s,c); }
float stateIs(float st,float code){ return 1.0-step(0.25,abs(st-code)); }
float starLayer(vec2 uv,float scale,float seed,float t){
  vec2 grid=uv*scale+seed;
  vec2 id=floor(grid);
  vec2 cell=fract(grid)-0.5;
  float rnd=hash21(id+seed);
  float star=step(0.982,rnd);
  float twinkle=0.55+0.45*sin(t*(0.6+hash21(id+17.0)*2.0)+rnd*6.28318);
  return star*smoothstep(0.055,0.0,length(cell))*twinkle;
}

void main(){
  vec2 uv=(gl_FragCoord.xy*2.0-u_res)/min(u_res.x,u_res.y);
  float r=length(uv); float ang=atan(uv.y,uv.x);
  float t = u_reduced>0.5 ? 9.0 : u_time;
  float st=u_state;
  float lvl=clamp(u_level,0.0,1.0);
  float sListen=stateIs(st,1.0);
  float sThink=stateIs(st,2.0);
  float sSpeak=stateIs(st,3.0);
  float sTool=stateIs(st,4.0);
  float sApproval=stateIs(st,5.0);
  float sError=stateIs(st,6.0);
  float err=max(sError,clamp(u_error,0.0,1.0));
  float breathe=0.5+0.5*sin(t*1.55);
  float activity=max(max(max(sListen,sThink),max(sSpeak,sTool)),max(sApproval,err));
  float voiceBright=clamp(lvl*(sListen+sSpeak)+0.22*sThink+0.18*sTool+0.10*sApproval+0.16*err,0.0,1.0);

  vec3 accent=u_ring;
  accent=mix(accent,mix(u_ring,u_particle,0.42),sThink);
  accent=mix(accent,mix(u_ring,u_particle,0.62),sTool);
  accent=mix(accent,u_appCol,sApproval);
  accent=mix(accent,u_errCol,err);

  vec2 driftA=uv*1.15+vec2(t*0.018,-t*0.012);
  vec2 driftB=uv*1.85+vec2(-t*0.010,t*0.016);
  float vignette=1.0-smoothstep(0.2,1.92,r);
  float nebA=smoothstep(0.42,0.82,fbm(vec3(driftA, t*0.035)));
  float nebB=smoothstep(0.50,0.88,fbm(vec3(driftB*rot(0.55), 4.0-t*0.025)));
  float stars=starLayer(uv,92.0,4.0,t)+starLayer(uv,148.0,31.0,t)*0.72;
  vec3 bg=mix(u_bgDeep,u_bg,0.34*vignette);
  bg+=u_glow*nebA*vignette*0.095;
  bg+=vec3(0.22,0.16,0.78)*nebB*vignette*0.082;
  bg+=vec3(0.58,0.74,1.0)*stars*(0.38+0.22*activity);

  float R=0.43*(1.0+0.026*breathe+0.070*voiceBright+0.018*sApproval-0.018*err);
  float rr=r/R;
  float z=sqrt(max(0.0,1.0-rr*rr));
  vec3 nrm=vec3(uv/R,z);
  nrm.xy*=rot(t*0.12+0.08*sin(t*0.21));
  float plasma=fbm(nrm*2.7+vec3(t*0.08,-t*0.06,t*0.18));
  float fine=fbm(nrm*6.0+vec3(-t*0.14,t*0.10,2.0));
  float disk=1.0-smoothstep(0.94,1.045,rr);
  float depth=clamp(1.0-rr*rr,0.0,1.0);
  float fres=pow(1.0-z,2.35)*disk;
  float clouds=smoothstep(0.38,0.90,plasma)*disk;
  float veins=smoothstep(0.58,0.95,fine+0.25*plasma)*disk;
  float atmospheric=exp(-r*r*1.72)*(0.34+0.52*voiceBright+0.16*activity);
  float halo=exp(-max(0.0,rr-0.86)*3.25)*(1.0-smoothstep(2.18,2.92,rr));
  float medium=exp(-pow(rr-1.0,2.0)*20.0);
  float inner=pow(depth,2.5)*disk;
  float core=exp(-rr*rr*4.45)*disk;

  vec3 orb=vec3(0.0);
  orb+=u_glow*atmospheric*0.62;
  orb+=accent*halo*(0.32+0.42*voiceBright);
  orb+=accent*medium*(0.68+1.18*voiceBright);
  orb+=u_glow*disk*(0.22+0.52*clouds)*(0.58+0.92*z);
  orb+=accent*veins*(0.24+0.42*voiceBright);
  orb+=u_core*inner*(0.96+1.10*voiceBright);
  orb+=vec3(1.0)*core*(0.36+0.48*voiceBright);
  orb+=accent*fres*(1.12+0.72*activity);

  float listenRing=exp(-pow(abs(rr-(1.13+0.055*sin(t*2.4))),2.0)*220.0);
  orb+=u_ring*listenRing*sListen*(0.62+1.70*lvl);

  float speakWave=exp(-pow(abs(rr-(1.04+0.22*lvl)),2.0)*72.0);
  float speakRipple=(0.55+0.45*sin(rr*22.0-t*5.2));
  orb+=u_core*speakWave*speakRipple*sSpeak*(0.38+1.30*lvl);
  orb+=u_glow*core*sSpeak*lvl*0.72;

  float sweep=pow(max(0.0,0.5+0.5*cos(ang-t*1.7)),8.0);
  orb+=accent*sweep*medium*sThink*1.42;

  float scan=exp(-pow(abs(uv.y-sin(t*0.9+uv.x*2.0)*0.08),2.0)*38.0);
  orb+=u_particle*scan*disk*sTool*0.28;

  float orbitStrength=sThink*0.78+sTool*1.18;
  for(int i=0;i<14;i++){
    float fi=float(i);
    float a=t*(0.76+0.42*sTool)+fi*0.448799;
    vec2 pp=rot(0.46+0.12*sin(t*0.3))*vec2(cos(a)*R*1.42,sin(a)*R*(0.52+0.18*sin(fi)));
    float d=length(uv-pp);
    orb+=u_particle*exp(-d*d*(230.0+80.0*sTool))*orbitStrength*(0.72+0.28*sin(t+fi));
  }

  float approvalRing=exp(-pow(abs(rr-1.17),2.0)*720.0)*(0.66+0.34*sin(t*2.7));
  orb+=u_appCol*approvalRing*sApproval*1.75;

  float glitch=step(0.56,hash(vec3(floor(uv.y*34.0),floor(t*16.0),7.0)));
  float errorRing=exp(-pow(abs(rr-(1.035+0.025*sin(t*15.0))),2.0)*380.0);
  orb=mix(orb,u_errCol*(disk*0.88+fres*1.75+medium*0.28),err*0.72);
  orb+=u_errCol*errorRing*glitch*err*1.22;

  vec3 col=bg+orb;
  col*=1.0-smoothstep(1.86,2.46,r)*0.44;
  col=1.0-exp(-col*1.12);
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
  return resolved.startsWith('color(') ? [nums[0], nums[1], nums[2]] : [nums[0] / 255, nums[1] / 255, nums[2] / 255]
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
    <div className={cn('jarvis-stage relative isolate overflow-hidden', className)} data-orb-state={state}>
      <canvas aria-hidden="true" className="block size-full" ref={canvasRef} />
    </div>
  )
}
