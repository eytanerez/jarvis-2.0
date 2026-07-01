// Dev-only console API (window.jarvisOrb) for exercising the real subagent
// pipeline without a live backend - e.g. `jarvisOrb.simulateDispatch('Audit the
// build')` in devtools. Writes straight into the same stores the gateway
// would, so it's a faithful test of the actual wiring, not a parallel mock.
import { $activeSessionId, setActiveSessionId } from '@/store/session'
import { $subagentsBySession, type SubagentProgress } from '@/store/subagents'

const DEBUG_SESSION_ID = 'jarvis-orb-debug-session'
let counter = 0

function upsert(patch: Partial<SubagentProgress> & { id: string }): void {
  const sessionId = $activeSessionId.get() ?? DEBUG_SESSION_ID

  if (!$activeSessionId.get()) {
    setActiveSessionId(sessionId)
  }

  const bySession = $subagentsBySession.get()
  const list = bySession[sessionId] ?? []
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

  const next = { ...base, ...(idx >= 0 ? list[idx] : {}), ...patch, updatedAt: now }
  const nextList = idx >= 0 ? list.map((p, i) => (i === idx ? next : p)) : [...list, next]
  $subagentsBySession.set({ ...bySession, [sessionId]: nextList })
}

export interface JarvisOrbDebugApi {
  simulateDispatch: (goal?: string, model?: string) => string
  completeDispatch: (id: string, status?: SubagentProgress['status']) => void
}

/** Installs `window.jarvisOrb` in dev builds only; returns an uninstaller. */
export function installOrbDebugConsole(): () => void {
  const api: JarvisOrbDebugApi = {
    completeDispatch: (id, status = 'completed') => upsert({ id, status }),
    simulateDispatch: (goal = 'Untitled task', model = 'claude-sonnet-5') => {
      counter += 1
      const id = `debug-${counter}-${Date.now()}`
      upsert({ goal, id, model, status: 'running' })

      return id
    }
  }

  ;(window as unknown as { jarvisOrb?: JarvisOrbDebugApi }).jarvisOrb = api

  return () => {
    delete (window as unknown as { jarvisOrb?: JarvisOrbDebugApi }).jarvisOrb
  }
}
