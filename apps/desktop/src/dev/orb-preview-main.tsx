// Dev-only harness for the orb scene: mounts it standalone (no HashRouter, no
// Electron IPC boot gate) with buttons to drive every state and simulate
// subagent dispatch, so the scene can be tuned and verified without a live
// backend. Not part of the app's routing or production bundle - only reached
// by opening orb-preview.html directly in dev.
import '../styles.css'

import { useState } from 'react'
import { createRoot } from 'react-dom/client'

import { JarvisOrbScene, type OrbState } from '@/components/jarvis-orb/JarvisOrbScene'
import { $activeSessionId } from '@/store/session'
import { $subagentsBySession, type SubagentProgress } from '@/store/subagents'

const PREVIEW_SESSION_ID = 'orb-preview-session'
$activeSessionId.set(PREVIEW_SESSION_ID)

const STATES: OrbState[] = ['idle', 'listening', 'thinking', 'speaking', 'toolUse', 'awaitingApproval', 'error']

const SAMPLE_GOALS = [
  'Audit the checkout flow for dead code',
  'Summarize open pull requests from this week',
  'Refactor the billing webhook handler',
  'Find flaky tests in the CI pipeline',
  'Draft release notes for v3.2'
]

let dispatchCounter = 0

function upsertSubagent(patch: Partial<SubagentProgress> & { id: string }) {
  const bySession = $subagentsBySession.get()
  const list = bySession[PREVIEW_SESSION_ID] ?? []
  const idx = list.findIndex(p => p.id === patch.id)
  const now = Date.now()

  const base: SubagentProgress = {
    filesRead: [],
    filesWritten: [],
    goal: 'Untitled task',
    id: patch.id,
    parentId: null,
    startedAt: now,
    status: 'running',
    stream: [],
    taskCount: 1,
    taskIndex: 0,
    updatedAt: now
  }

  const next = { ...base, ...(idx >= 0 ? list[idx] : {}), ...patch }
  const nextList = idx >= 0 ? list.map((p, i) => (i === idx ? next : p)) : [...list, next]
  $subagentsBySession.set({ ...bySession, [PREVIEW_SESSION_ID]: nextList })
}

function dispatchFakeAgent() {
  dispatchCounter += 1
  const id = `preview-${dispatchCounter}-${Date.now()}`
  const goal = SAMPLE_GOALS[dispatchCounter % SAMPLE_GOALS.length]!
  upsertSubagent({ id, goal, model: 'claude-sonnet-5', status: 'running' })

  return id
}

function completeFakeAgent(id: string, status: SubagentProgress['status'] = 'completed') {
  upsertSubagent({ id, status })
}

function Harness() {
  const [state, setState] = useState<OrbState>('idle')
  const [level, setLevel] = useState(0)
  const [reducedMotion, setReducedMotion] = useState(false)
  const [lastIds, setLastIds] = useState<string[]>([])

  return (
    <div style={{ background: '#000', height: '100vh', width: '100vw' }}>
      <JarvisOrbScene
        className="absolute inset-0"
        getLevel={s => (s === 'listening' || s === 'speaking' ? level : 0)}
        reducedMotion={reducedMotion}
        state={state}
      />
      <div
        style={{
          background: 'rgba(5,8,17,0.85)',
          border: '1px solid rgba(56,163,255,0.3)',
          borderRadius: 8,
          color: '#b7cce8',
          display: 'flex',
          flexDirection: 'column',
          fontFamily: 'ui-sans-serif, system-ui',
          fontSize: 12,
          gap: 8,
          left: 12,
          padding: 12,
          position: 'fixed',
          top: 12,
          width: 260,
          zIndex: 10000
        }}
      >
        <strong>Orb preview harness</strong>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {STATES.map(s => (
            <button
              key={s}
              onClick={() => setState(s)}
              style={{
                background: state === s ? '#38a3ff' : '#121b2b',
                border: 'none',
                borderRadius: 4,
                color: state === s ? '#020408' : '#b7cce8',
                cursor: 'pointer',
                fontSize: 11,
                padding: '4px 6px'
              }}
              type="button"
            >
              {s}
            </button>
          ))}
        </div>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          level: {level.toFixed(2)}
          <input
            max={1}
            min={0}
            onChange={e => setLevel(Number(e.target.value))}
            step={0.01}
            type="range"
            value={level}
          />
        </label>
        <label style={{ alignItems: 'center', display: 'flex', gap: 6 }}>
          <input checked={reducedMotion} onChange={e => setReducedMotion(e.target.checked)} type="checkbox" />
          reduced motion
        </label>
        <hr style={{ borderColor: 'rgba(183,204,232,0.2)', width: '100%' }} />
        <button
          onClick={() => setLastIds(ids => [...ids, dispatchFakeAgent()])}
          style={{ background: '#0053fd', border: 'none', borderRadius: 4, color: 'white', cursor: 'pointer', padding: '6px 8px' }}
          type="button"
        >
          Dispatch subagent
        </button>
        <button
          onClick={() => {
            const id = lastIds.at(-1)

            if (id) {
              completeFakeAgent(id, 'completed')
            }
          }}
          style={{ background: '#121b2b', border: 'none', borderRadius: 4, color: '#b7cce8', cursor: 'pointer', padding: '6px 8px' }}
          type="button"
        >
          Complete last
        </button>
        <button
          onClick={() => {
            const id = lastIds.at(-1)

            if (id) {
              completeFakeAgent(id, 'failed')
            }
          }}
          style={{ background: '#121b2b', border: 'none', borderRadius: 4, color: '#b7cce8', cursor: 'pointer', padding: '6px 8px' }}
          type="button"
        >
          Fail last
        </button>
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<Harness />)
