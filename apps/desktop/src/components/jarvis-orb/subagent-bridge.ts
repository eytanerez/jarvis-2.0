import type { SubagentProgress } from '@/store/subagents'

import { createConstellationAgent } from './constellation'
import type { ConstellationAgent } from './types'

export const FADE_OUT_MS = 2200
export const DISPATCH_FLARE_MS = 2600

const isTerminal = (status: SubagentProgress['status']) =>
  status === 'completed' || status === 'failed' || status === 'interrupted'

interface Entry {
  agent: ConstellationAgent
  completedAt: number | null
}

/**
 * Turns the real, ephemeral, tree-shaped subagent-progress feed into a stable
 * constellation: each id gets its orbit parameters once and keeps them for
 * its lifetime, survives brief payload gaps, and fades out gracefully after
 * going terminal instead of just disappearing. Call `sync` once per animation
 * frame with fresh store reads (no React subscription - avoids pushing this
 * at frame rate through React state).
 */
export class SubagentConstellationBridge {
  private entries = new Map<string, Entry>()
  private order = 0

  sync(bySession: Record<string, SubagentProgress[]>, activeSessionId: string | null, nowMs: number): ConstellationAgent[] {
    const list = activeSessionId ? (bySession[activeSessionId] ?? []) : []
    const seen = new Set<string>()

    for (const progress of list) {
      seen.add(progress.id)
      const existing = this.entries.get(progress.id)
      const terminal = isTerminal(progress.status)

      if (existing) {
        existing.agent.detail = progress.goal

        if (terminal && existing.completedAt === null) {
          existing.completedAt = nowMs
        } else if (!terminal) {
          existing.completedAt = null
        }
      } else {
        const agent = createConstellationAgent(progress.id, progress.goal, progress.model ?? 'Subagent', this.order++, nowMs)
        this.entries.set(progress.id, { agent, completedAt: terminal ? nowMs : null })
      }
    }

    for (const [id, entry] of this.entries) {
      if (!seen.has(id) && entry.completedAt === null) {
        entry.completedAt = nowMs
      }

      if (entry.completedAt !== null && nowMs - entry.completedAt > FADE_OUT_MS) {
        this.entries.delete(id)
      }
    }

    return Array.from(this.entries.values(), ({ agent, completedAt }) => {
      const arriving = nowMs - agent.dispatchedAt < DISPATCH_FLARE_MS
      const lifecycle: ConstellationAgent['lifecycle'] = completedAt !== null ? 'departing' : arriving ? 'arriving' : 'working'

      return { ...agent, completedAt, lifecycle }
    })
  }

  reset(): void {
    this.entries.clear()
    this.order = 0
  }
}
