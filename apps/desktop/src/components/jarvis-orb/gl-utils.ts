// Small, dependency-free WebGL2 helpers shared by the orb and background
// layers: shader/program creation, buffer upload, and generated-texture
// upload. Nothing here is scene-specific.

export function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)

  if (!shader) {
    throw new Error('[jarvis-orb] unable to create shader')
  }

  gl.shaderSource(shader, source)
  gl.compileShader(shader)

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader)
    gl.deleteShader(shader)
    throw new Error(`[jarvis-orb] shader compile failed: ${log}`)
  }

  return shader
}

export function createProgram(gl: WebGL2RenderingContext, vertexSrc: string, fragmentSrc: string): WebGLProgram {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vertexSrc)
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSrc)
  const program = gl.createProgram()

  if (!program) {
    throw new Error('[jarvis-orb] unable to create program')
  }

  gl.attachShader(program, vs)
  gl.attachShader(program, fs)
  gl.linkProgram(program)
  gl.deleteShader(vs)
  gl.deleteShader(fs)

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program)
    gl.deleteProgram(program)
    throw new Error(`[jarvis-orb] program link failed: ${log}`)
  }

  return program
}

export function createFloatBuffer(gl: WebGL2RenderingContext, data: Float32Array, usage = gl.STATIC_DRAW): WebGLBuffer {
  const buffer = gl.createBuffer()

  if (!buffer) {
    throw new Error('[jarvis-orb] unable to create buffer')
  }

  gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
  gl.bufferData(gl.ARRAY_BUFFER, data, usage)

  return buffer
}

export function createIndexBuffer(gl: WebGL2RenderingContext, data: Uint16Array | Uint32Array): WebGLBuffer {
  const buffer = gl.createBuffer()

  if (!buffer) {
    throw new Error('[jarvis-orb] unable to create index buffer')
  }

  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffer)
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, data, gl.STATIC_DRAW)

  return buffer
}

export function setAttribute(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  buffer: WebGLBuffer,
  name: string,
  size: number,
  stride = 0,
  offset = 0
): void {
  const loc = gl.getAttribLocation(program, name)

  if (loc < 0) {
    return
  }

  gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
  gl.enableVertexAttribArray(loc)
  gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, offset)
}

export function uniformLocations<T extends string>(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  names: readonly T[]
): Record<T, WebGLUniformLocation | null> {
  const out = {} as Record<T, WebGLUniformLocation | null>

  for (const name of names) {
    out[name] = gl.getUniformLocation(program, name)
  }

  return out
}

/** Upload a canvas2D-drawn sprite (avatar, glow dot, etc.) as an RGBA texture. */
export function textureFromCanvas(gl: WebGL2RenderingContext, canvas: HTMLCanvasElement): WebGLTexture {
  const texture = gl.createTexture()

  if (!texture) {
    throw new Error('[jarvis-orb] unable to create texture')
  }

  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)

  return texture
}

/** RGB 0-1 read from a CSS custom property, resolved through the DOM so
 * color-mix()/oklch()/etc. tokens all normalize the same way. */
export function readCssColor(host: HTMLElement, varName: string): [number, number, number] {
  const probe = document.createElement('span')
  probe.style.color = getComputedStyle(host).getPropertyValue(varName)
  host.appendChild(probe)
  const resolved = getComputedStyle(probe).color
  probe.remove()
  const nums = (resolved.match(/[\d.]+/g) ?? ['0', '0', '0']).map(Number)

  return resolved.startsWith('color(') ? [nums[0]!, nums[1]!, nums[2]!] : [nums[0]! / 255, nums[1]! / 255, nums[2]! / 255]
}

export function resizeCanvasToDisplaySize(canvas: HTMLCanvasElement, maxDpr = 2, scale = 1): boolean {
  const dpr = Math.min(maxDpr, window.devicePixelRatio || 1) * scale
  const w = Math.max(1, Math.round(canvas.clientWidth * dpr))
  const h = Math.max(1, Math.round(canvas.clientHeight * dpr))

  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w
    canvas.height = h

    return true
  }

  return false
}
