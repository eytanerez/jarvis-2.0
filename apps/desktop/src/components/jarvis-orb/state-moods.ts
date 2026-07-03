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

// Every state shares roughly the same brightness/amplitude/halo presence as
// 'speaking' - moods are told apart by color, churn, spin, and rings, never
// by fading the orb out. There should be no dim/thin/hard-to-see resting state.
export const MOOD_TARGETS: Record<OrbState, MoodTarget> = {
  awaitingApproval: {
    ampBase: 0.95,
    approvalRing: 1,
    brightness: 1.3,
    churn: 0.6,
    colorMode: 'approval',
    haloScale: 1.45,
    jagged: 0,
    ringsActive: 0,
    sizePulse: 0,
    spinSpeed: 0.3
  },
  error: {
    ampBase: 0.9,
    approvalRing: 0,
    brightness: 1.25,
    churn: 0.18,
    colorMode: 'error',
    haloScale: 1.4,
    jagged: 0.85,
    ringsActive: 0,
    sizePulse: 0,
    spinSpeed: 0.05
  },
  idle: {
    ampBase: 0.95,
    approvalRing: 0,
    brightness: 1.2,
    churn: 0.5,
    colorMode: 'accent',
    haloScale: 1.4,
    jagged: 0,
    ringsActive: 0,
    sizePulse: 0,
    spinSpeed: 0.4
  },
  // listening/speaking baselines are intentionally calmer than they used to
  // be - churn/spin used to be constantly cranked whether or not there was
  // any actual sound, which read as the orb "going crazy" the moment a voice
  // turn started. The energy budget moved into the live level instead (see
  // OrbSceneLayer's audioBoost), so these are the at-rest floor and the orb
  // only gets churny/fast/big in sync with real mic/TTS loudness.
  listening: {
    ampBase: 0.9,
    approvalRing: 0,
    brightness: 1.25,
    churn: 0.6,
    colorMode: 'amber',
    haloScale: 1.45,
    jagged: 0,
    ringsActive: 0,
    sizePulse: 0.3,
    spinSpeed: 0.42
  },
  speaking: {
    ampBase: 0.85,
    approvalRing: 0,
    brightness: 1.3,
    churn: 0.75,
    colorMode: 'accent',
    haloScale: 1.5,
    jagged: 0.08,
    ringsActive: 0,
    // Almost entirely level-gated (see OrbSceneLayer's sizeScale) - this is
    // the "mouth" of the orb, so it pulses with the actual TTS envelope and
    // rests still between words instead of wobbling constantly.
    sizePulse: 0.8,
    spinSpeed: 0.55
  },
  // Thinking sits between listening (0.6 churn) and its old frantic self
  // (1.6/0.85) - the helix rings and cycling color already carry the
  // "working on it" identity, and during voice turns the orb passes through
  // thinking on EVERY turn, so a violent churn/spin spike here made each
  // state change read as the orb going haywire rather than settling.
  thinking: {
    ampBase: 0.95,
    approvalRing: 0,
    brightness: 1.25,
    churn: 1.15,
    colorMode: 'cycle',
    haloScale: 1.4,
    jagged: 0.15,
    ringsActive: 1,
    sizePulse: 0,
    spinSpeed: 0.65
  },
  toolUse: {
    ampBase: 0.95,
    approvalRing: 0,
    brightness: 1.25,
    churn: 1.2,
    colorMode: 'cycleTool',
    haloScale: 1.4,
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
 * orb to life but it eases back down instead of twitching frame to frame. Tuned
 * down from 18 - at that rate the envelope tracked raw mic/analyser noise almost
 * sample-for-sample instead of the speech envelope, which read as jitter. Pairs
 * with the bigger analyser windows in voice-analyser.ts/use-mic-recorder.ts,
 * which smooth the *source* signal so this stage isn't fighting single-frame noise. */
export const LEVEL_ATTACK_RATE = 14
export const LEVEL_RELEASE_RATE = 3
