// Minimal 3D math: just enough to place points on tilted orbits and a
// wireframe sphere, and project them through a perspective camera onto the
// 2D canvas. No external dependency - the whole scene only ever needs a
// handful of operations, so a bespoke ~150 line module keeps full control
// over precision and avoids pulling in a general-purpose linear algebra lib.

export type Vec3 = [number, number, number]
// Column-major 4x4, same layout WebGL expects for uniformMatrix4fv.
export type Mat4 = Float32Array

export function vec3(x = 0, y = 0, z = 0): Vec3 {
  return [x, y, z]
}

export function addVec3(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}

export function subVec3(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

export function scaleVec3(a: Vec3, s: number): Vec3 {
  return [a[0] * s, a[1] * s, a[2] * s]
}

export function lerpVec3(a: Vec3, b: Vec3, t: number): Vec3 {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
}

export function lengthVec3(a: Vec3): number {
  return Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2])
}

export function normalizeVec3(a: Vec3): Vec3 {
  const len = lengthVec3(a) || 1

  return [a[0] / len, a[1] / len, a[2] / len]
}

export function crossVec3(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}

export function dotVec3(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

export function identity4(): Mat4 {
  // prettier-ignore
  return new Float32Array([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1
  ])
}

export function multiply4(a: Mat4, b: Mat4): Mat4 {
  const out = new Float32Array(16)

  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      let sum = 0

      for (let k = 0; k < 4; k++) {
        sum += a[k * 4 + row]! * b[col * 4 + k]!
      }

      out[col * 4 + row] = sum
    }
  }

  return out
}

export function perspective4(fovYRadians: number, aspect: number, near: number, far: number): Mat4 {
  const f = 1 / Math.tan(fovYRadians / 2)
  const nf = 1 / (near - far)
  const out = new Float32Array(16)
  out[0] = f / aspect
  out[5] = f
  out[10] = (far + near) * nf
  out[11] = -1
  out[14] = 2 * far * near * nf

  return out
}

// Right-handed look-at, camera looking from `eye` toward `target`.
export function lookAt4(eye: Vec3, target: Vec3, up: Vec3): Mat4 {
  const z = normalizeVec3(subVec3(eye, target))
  const x = normalizeVec3(crossVec3(up, z))
  const y = crossVec3(z, x)
  const out = new Float32Array(16)
  out[0] = x[0]; out[1] = y[0]; out[2] = z[0]; out[3] = 0
  out[4] = x[1]; out[5] = y[1]; out[6] = z[1]; out[7] = 0
  out[8] = x[2]; out[9] = y[2]; out[10] = z[2]; out[11] = 0
  out[12] = -dotVec3(x, eye)
  out[13] = -dotVec3(y, eye)
  out[14] = -dotVec3(z, eye)
  out[15] = 1

  return out
}

export function rotationX4(angle: number): Mat4 {
  const c = Math.cos(angle)
  const s = Math.sin(angle)

  // prettier-ignore
  return new Float32Array([
    1, 0, 0, 0,
    0, c, s, 0,
    0, -s, c, 0,
    0, 0, 0, 1
  ])
}

export function rotationY4(angle: number): Mat4 {
  const c = Math.cos(angle)
  const s = Math.sin(angle)

  // prettier-ignore
  return new Float32Array([
    c, 0, -s, 0,
    0, 1, 0, 0,
    s, 0, c, 0,
    0, 0, 0, 1
  ])
}

export function rotationZ4(angle: number): Mat4 {
  const c = Math.cos(angle)
  const s = Math.sin(angle)

  // prettier-ignore
  return new Float32Array([
    c, s, 0, 0,
    -s, c, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1
  ])
}

export function scaling4(sx: number, sy: number, sz: number): Mat4 {
  // prettier-ignore
  return new Float32Array([
    sx, 0, 0, 0,
    0, sy, 0, 0,
    0, 0, sz, 0,
    0, 0, 0, 1
  ])
}

export function translation4(x: number, y: number, z: number): Mat4 {
  // prettier-ignore
  return new Float32Array([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    x, y, z, 1
  ])
}

export function composeMat4(...mats: Mat4[]): Mat4 {
  return mats.reduce((acc, m) => multiply4(acc, m))
}

export function rotateY(v: Vec3, angle: number): Vec3 {
  const c = Math.cos(angle)
  const s = Math.sin(angle)

  return [v[0] * c + v[2] * s, v[1], -v[0] * s + v[2] * c]
}

export function rotateX(v: Vec3, angle: number): Vec3 {
  const c = Math.cos(angle)
  const s = Math.sin(angle)

  return [v[0], v[1] * c - v[2] * s, v[1] * s + v[2] * c]
}

export function rotateZ(v: Vec3, angle: number): Vec3 {
  const c = Math.cos(angle)
  const s = Math.sin(angle)

  return [v[0] * c - v[1] * s, v[0] * s + v[1] * c, v[2]]
}

/** Transform a point by a column-major 4x4 matrix (w assumed 1). */
export function transformPoint(m: Mat4, p: Vec3): [number, number, number, number] {
  const x = p[0], y = p[1], z = p[2]
  const rx = m[0]! * x + m[4]! * y + m[8]! * z + m[12]!
  const ry = m[1]! * x + m[5]! * y + m[9]! * z + m[13]!
  const rz = m[2]! * x + m[6]! * y + m[10]! * z + m[14]!
  const rw = m[3]! * x + m[7]! * y + m[11]! * z + m[15]!

  return [rx, ry, rz, rw]
}

export interface ScreenPoint {
  x: number
  y: number
  /** View-space depth (positive = further from camera). Used for z-sorting. */
  depth: number
  /** 0..1, how much this point is facing the camera vs. wrapped behind the orb. */
  facing: number
  /** false once behind the near/far clip or far enough behind the orb to hide. */
  visible: boolean
}

/**
 * Project a world-space point through view*proj onto canvas pixel coordinates.
 * `facing` estimates how "in front" a point on the orb's orbit shell is by
 * comparing its side of the orb (dot of its direction from origin with the
 * view direction) - used to fade constellation labels behind the orb.
 */
export function projectToScreen(
  viewProj: Mat4,
  point: Vec3,
  viewportW: number,
  viewportH: number,
  cameraPos: Vec3
): ScreenPoint {
  const [cx, cy, cz, cw] = transformPoint(viewProj, point)

  if (cw <= 0.0001) {
    return { depth: 0, facing: 0, visible: false, x: 0, y: 0 }
  }

  const ndcX = cx / cw
  const ndcY = cy / cw
  const ndcZ = cz / cw
  const x = ((ndcX + 1) / 2) * viewportW
  const y = ((1 - ndcY) / 2) * viewportH
  const toCam = normalizeVec3(subVec3(cameraPos, point))
  const outward = normalizeVec3(point)
  const facing = Math.max(0, dotVec3(toCam, outward))
  const visible = ndcZ > -1 && ndcZ < 1

  return { depth: cz, facing, visible, x, y }
}

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1)

  return t * t * (3 - 2 * t)
}

/** Frame-rate independent exponential ease toward `target`. `rate` ~ 1/seconds-to-settle. */
export function damp(current: number, target: number, rate: number, dt: number): number {
  return current + (target - current) * (1 - Math.exp(-rate * dt))
}
