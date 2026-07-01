// Shared types for the orb scene, kept separate from rendering code so the
// React component, the subagent bridge, and the render layers can all import
// them without pulling in WebGL.

/** The seven cockpit states the orb can portray. */
export type OrbState = 'awaitingApproval' | 'error' | 'idle' | 'listening' | 'speaking' | 'thinking' | 'toolUse'

export type AgentLifecycle = 'arriving' | 'departing' | 'orbiting' | 'working'

export interface ConstellationAgent {
  id: string
  /** Short name shown on the top line of the label. */
  name: string
  /** One-line specialty/goal shown beneath the name. */
  detail: string
  /** RGB 0-1, hashed from the agent id so it's stable across renders. */
  color: [number, number, number]
  /** Single glyph drawn in the generated avatar (usually the first letter of `name`). */
  initial: string
  lifecycle: AgentLifecycle
  /** Orbit parameters, assigned once per id and kept stable for its lifetime. */
  orbitRadius: number
  orbitSpeed: number
  orbitPhase: number
  /** Radians; alternates sign per agent so paths sit in different planes. */
  orbitTilt: number
  /** Radians; rotates the tilt axis around Y so planes don't all share one axis. */
  orbitAzimuth: number
  breathPhase: number
  /** ms timestamp the agent entered the constellation - drives the dispatch flare/beam. */
  dispatchedAt: number
  /** ms timestamp the agent left terminal state, if any - drives the fade-out. */
  completedAt: number | null
}

export interface OrbGetLevel {
  (state: OrbState): number
}
