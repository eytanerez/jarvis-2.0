import type { OrbState } from './types'

export type ColorMode = 'accent' | 'amber' | 'approval' | 'cycle' | 'cycleTool' | 'error'

export interface MoodTarget {
  /** Overall glow/line intensity. */
  brightness: number
  /** Noise time-evolution speed - how fast the surface churns. */
  churn: number
  /** Baseline displacement amplitude (breathing), before audio adds more. */
  ampBase: number
  /** High-frequency-noise weight; higher reads as sharper/more jagged (error). */
  jagged: number
  /** Tumble speed multiplier. */
  spinSpeed: number
  /** Glow halo size multiplier. */
  haloScale: number
  colorMode: ColorMode
  /** 0-1, how present the Tier 5 helix rings should be. */
  ringsActive: number
  /** Extra size breathing driven by audio level (speaking). */
  sizePulse: number
  /** Steady pulsing rim ring (awaiting-approval "waiting on you" cue). */
  approvalRing: number
}

export const MOOD_TARGETS: Record<OrbState, MoodTarget> = {
  awaitingApproval: {
    ampBase: 0.5,
    approvalRing: 1,
    brightness: 1.0,
    churn: 0.6,
    colorMode: 'approval',
    haloScale: 1.25,
    jagged: 0,
    ringsActive: 0,
    sizePulse: 0,
    spinSpeed: 0.3
  },
  error: {
    ampBase: 0.42,
    approvalRing: 0,
    brightness: 0.88,
    churn: 0.18,
    colorMode: 'error',
    haloScale: 1.15,
    jagged: 0.85,
    ringsActive: 0,
    sizePulse: 0,
    spinSpeed: 0.05
  },
  idle: {
    ampBase: 0.55,
    approvalRing: 0,
    brightness: 0.34,
    churn: 0.5,
    colorMode: 'accent',
    haloScale: 0.85,
    jagged: 0,
    ringsActive: 0,
    sizePulse: 0,
    spinSpeed: 0.4
  },
  listening: {
    ampBase: 0.65,
    approvalRing: 0,
    brightness: 1.15,
    churn: 0.9,
    colorMode: 'amber',
    haloScale: 1.35,
    jagged: 0,
    ringsActive: 0,
    sizePulse: 0.15,
    spinSpeed: 0.55
  },
  speaking: {
    ampBase: 1.0,
    approvalRing: 0,
    brightness: 1.3,
    churn: 1.35,
    colorMode: 'accent',
    haloScale: 1.5,
    jagged: 0.1,
    ringsActive: 0,
    sizePulse: 0.45,
    spinSpeed: 1.15
  },
  thinking: {
    ampBase: 0.85,
    approvalRing: 0,
    brightness: 0.62,
    churn: 1.6,
    colorMode: 'cycle',
    haloScale: 1.05,
    jagged: 0.15,
    ringsActive: 1,
    sizePulse: 0,
    spinSpeed: 0.85
  },
  toolUse: {
    ampBase: 0.75,
    approvalRing: 0,
    brightness: 0.7,
    churn: 1.2,
    colorMode: 'cycleTool',
    haloScale: 1.1,
    jagged: 0.1,
    ringsActive: 1,
    sizePulse: 0.1,
    spinSpeed: 0.7
  }
}

/** How quickly each scalar mood field eases toward its target, in 1/seconds. Slower
 * than a typical UI transition on purpose - state changes should feel like a settle. */
export const MOOD_EASE_RATE = 1.1

/** Audio level smoothing: fast attack, slow release, so a loud syllable snaps the
 * orb to life but it eases back down instead of twitching frame to frame. */
export const LEVEL_ATTACK_RATE = 18
export const LEVEL_RELEASE_RATE = 2.6
