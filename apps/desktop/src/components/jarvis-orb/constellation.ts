import type { ConstellationAgent } from './types'

/** Eight cool hues shared between constellation avatars and the background's
 * distant node clusters, so the whole scene reads as one consistent palette. */
export const COOL_PALETTE: ReadonlyArray<[number, number, number]> = [
  [0.1, 0.78, 0.66], // teal
  [0.2, 0.75, 0.95], // cyan
  [0.3, 0.55, 0.98], // sky blue
  [0.35, 0.45, 0.95], // azure
  [0.48, 0.42, 0.95], // indigo
  [0.62, 0.4, 0.95], // violet
  [0.78, 0.35, 0.85], // magenta
  [0.25, 0.85, 0.55] // spring green
]

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5)) * 2

export function hashString(input: string): number {
  let h = 2166136261

  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }

  return h >>> 0
}

export function colorForId(id: string): [number, number, number] {
  const hash = hashString(id)

  return COOL_PALETTE[hash % COOL_PALETTE.length]!
}

export function compactText(text: string, max: number): string {
  const line = text.replace(/\s+/g, ' ').trim()

  if (!line) {
    return ''
  }

  return line.length > max ? `${line.slice(0, max - 1)}…` : line
}

function titleCase(word: string): string {
  return word.length ? word[0]!.toUpperCase() + word.slice(1) : word
}

export function nameFromGoal(goal: string): string {
  const words = goal.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean)

  if (words.length === 0) {
    return 'Subagent'
  }

  const name = words.slice(0, 3).join(' ')

  return titleCase(compactText(name, 24))
}

export interface OrbitAssignment {
  orbitRadius: number
  orbitSpeed: number
  orbitPhase: number
  orbitTilt: number
  orbitAzimuth: number
  breathPhase: number
}

/** Spreads agents out on the circle (golden-angle phase step) with alternating
 * tilt direction and slightly varied radius/speed, so paths never sit in the
 * same plane or move in lockstep. `order` is the agent's dispatch index. */
export function assignOrbit(id: string, order: number): OrbitAssignment {
  const hash = hashString(id)
  const hash2 = hashString(`${id}:2`)
  const direction = hash % 2 === 0 ? 1 : -1
  const tiltSign = order % 2 === 0 ? 1 : -1

  return {
    breathPhase: ((hash2 % 1000) / 1000) * Math.PI * 2,
    orbitAzimuth: ((hash >> 7) % 1000 / 1000) * Math.PI * 2,
    orbitPhase: (order * GOLDEN_ANGLE + ((hash % 1000) / 1000) * 0.6) % (Math.PI * 2),
    orbitRadius: 2.15 + (hash % 6) * 0.09,
    orbitSpeed: direction * (0.1 + (hash2 % 5) * 0.024),
    orbitTilt: tiltSign * (0.35 + ((hash >> 3) % 10) * 0.045)
  }
}

export function createConstellationAgent(
  id: string,
  goal: string,
  detail: string,
  order: number,
  nowMs: number
): ConstellationAgent {
  const name = nameFromGoal(goal)
  const orbit = assignOrbit(id, order)

  return {
    breathPhase: orbit.breathPhase,
    color: colorForId(id),
    completedAt: null,
    detail: compactText(detail, 40),
    dispatchedAt: nowMs,
    id,
    initial: name.slice(0, 1),
    lifecycle: 'arriving',
    name,
    orbitAzimuth: orbit.orbitAzimuth,
    orbitPhase: orbit.orbitPhase,
    orbitRadius: orbit.orbitRadius,
    orbitSpeed: orbit.orbitSpeed,
    orbitTilt: orbit.orbitTilt
  }
}
