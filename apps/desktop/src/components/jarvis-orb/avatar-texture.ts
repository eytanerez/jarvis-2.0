// Generates a small sprite-sheet canvas for constellation avatars: a soft
// additive glow dot (used for orbit nodes, dust, ping rings) and, per agent
// color, a disc avatar (dark core -> accent rim, initial lettered) so a
// brand-new agent looks finished with zero art.

const AVATAR_SIZE = 128

export function buildGlowDotCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = AVATAR_SIZE
  canvas.height = AVATAR_SIZE
  const ctx = canvas.getContext('2d')!
  const r = AVATAR_SIZE / 2
  const gradient = ctx.createRadialGradient(r, r, 0, r, r, r)
  gradient.addColorStop(0, 'rgba(255,255,255,1)')
  gradient.addColorStop(0.35, 'rgba(255,255,255,0.55)')
  gradient.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, AVATAR_SIZE, AVATAR_SIZE)

  return canvas
}

/** A thin glow ring (bright edge, transparent center and outside) used for
 * dispatch pings and the processing rings - one shared sprite, tinted per use. */
export function buildRingCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = AVATAR_SIZE
  canvas.height = AVATAR_SIZE
  const ctx = canvas.getContext('2d')!
  const r = AVATAR_SIZE / 2
  const gradient = ctx.createRadialGradient(r, r, r * 0.62, r, r, r)
  gradient.addColorStop(0, 'rgba(255,255,255,0)')
  gradient.addColorStop(0.72, 'rgba(255,255,255,0)')
  gradient.addColorStop(0.86, 'rgba(255,255,255,1)')
  gradient.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, AVATAR_SIZE, AVATAR_SIZE)

  return canvas
}

function toCss([r, g, b]: [number, number, number], alpha = 1): string {
  return `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${alpha})`
}

export function buildAvatarCanvas(color: [number, number, number], initial: string): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = AVATAR_SIZE
  canvas.height = AVATAR_SIZE
  const ctx = canvas.getContext('2d')!
  const r = AVATAR_SIZE / 2

  // Soft additive halo behind the disc so it reads as a small light source.
  const halo = ctx.createRadialGradient(r, r, 0, r, r, r)
  halo.addColorStop(0, toCss(color, 0.55))
  halo.addColorStop(0.5, toCss(color, 0.22))
  halo.addColorStop(1, toCss(color, 0))
  ctx.fillStyle = halo
  ctx.fillRect(0, 0, AVATAR_SIZE, AVATAR_SIZE)

  // Disc: dark core fading out to the accent color at the rim.
  const discR = r * 0.62
  const disc = ctx.createRadialGradient(r, r, 0, r, r, discR)
  disc.addColorStop(0, toCss([color[0] * 0.35, color[1] * 0.35, color[2] * 0.35], 1))
  disc.addColorStop(0.7, toCss(color, 0.9))
  disc.addColorStop(1, toCss(color, 1))
  ctx.beginPath()
  ctx.fillStyle = disc
  ctx.arc(r, r, discR, 0, Math.PI * 2)
  ctx.fill()

  // Thin bright rim.
  ctx.beginPath()
  ctx.lineWidth = discR * 0.06
  ctx.strokeStyle = toCss([Math.min(1, color[0] + 0.4), Math.min(1, color[1] + 0.4), Math.min(1, color[2] + 0.4)], 0.9)
  ctx.arc(r, r, discR - ctx.lineWidth, 0, Math.PI * 2)
  ctx.stroke()

  // Initial.
  ctx.fillStyle = 'rgba(255,255,255,0.95)'
  ctx.font = `600 ${Math.round(discR * 0.95)}px ui-sans-serif, system-ui, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(initial.slice(0, 1).toUpperCase(), r, r + discR * 0.03)

  return canvas
}
