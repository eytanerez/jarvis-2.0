import { useStore } from '@nanostores/react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { NEW_CHAT_ROUTE } from '@/app/routes'
import { BeveledButton } from '@/components/chrome/beveled-button'
import { Codicon } from '@/components/ui/codicon'
import { useMediaQuery } from '@/hooks/use-media-query'
import { useI18n } from '@/i18n'
import { chatMessageText } from '@/lib/chat-messages'
import { sessionTitle } from '@/lib/chat-runtime'
import { currentTurnToolActivities, TOOL_ACTIVITY_SETTLED_TTL_MS, type ToolActivityModel } from '@/lib/tool-activity'
import { cn } from '@/lib/utils'
import { $liveVoiceTranscript, useOrbState } from '@/store/jarvis-cockpit'
import { $activeProfile } from '@/store/profile'
import {
  $activeSessionId,
  $awaitingResponse,
  $busy,
  $currentModel,
  $currentProvider,
  $gatewayState,
  $messages,
  $selectedStoredSessionId,
  $sessions
} from '@/store/session'

type ConnectionTone = 'connecting' | 'offline' | 'online'

function connectionTone(gatewayState: string): ConnectionTone {
  if (gatewayState === 'open') {
    return 'online'
  }

  if (gatewayState === 'connecting' || gatewayState === 'idle') {
    return 'connecting'
  }

  return 'offline'
}

const TONE_DOT: Record<ConnectionTone, string> = {
  connecting: 'bg-(--ui-yellow)',
  offline: 'bg-(--ui-red)',
  online: 'bg-(--ui-green)'
}

// Slim identity/telemetry strip above the orb. Low-frequency subscriptions only.
function CockpitTopStrip({ onCancel }: { onCancel: () => Promise<void> | void }) {
  const { t } = useI18n()
  const navigate = useNavigate()
  const gatewayState = useStore($gatewayState)
  const profile = useStore($activeProfile)
  const model = useStore($currentModel)
  const provider = useStore($currentProvider)
  const busy = useStore($busy)
  const awaitingResponse = useStore($awaitingResponse)
  const activeSessionId = useStore($activeSessionId)
  const selectedSessionId = useStore($selectedStoredSessionId)
  const sessions = useStore($sessions)
  const tone = connectionTone(gatewayState)
  const running = busy || awaitingResponse

  const activeStoredSession =
    sessions.find(session => session.id === selectedSessionId || session._lineage_root_id === selectedSessionId) || null

  const title = activeStoredSession
    ? sessionTitle(activeStoredSession)
    : activeSessionId
      ? t.jarvis.sessionActive
      : t.jarvis.newSession

  return (
    // No titlebar offset here: ChatView reserves the titlebar row above the
    // runtime area, even before a session exists.
    <div className="relative z-10 flex items-center gap-4 border-b border-[color-mix(in_srgb,var(--theme-jarvis-stroke)_46%,transparent)] bg-[linear-gradient(180deg,color-mix(in_srgb,var(--theme-jarvis-panel)_46%,transparent),transparent)] px-5 py-2 backdrop-blur-[0.375rem]">
      <span className="jarvis-wordmark text-[0.8125rem]">{t.jarvis.wordmark}</span>

      <span className="flex items-center gap-1.5">
        <span className={cn('size-1.5 rounded-full', TONE_DOT[tone])} />
        <span className="jarvis-tech jarvis-tech-dim">{t.jarvis.connection[tone]}</span>
      </span>

      <span className="ml-auto flex items-center gap-4">
        <span className="jarvis-tech jarvis-tech-dim">
          {t.jarvis.profile}: <span className="text-(--theme-jarvis-text-tech)">{profile}</span>
        </span>
        {(model || provider) && (
          <span className="jarvis-tech jarvis-tech-dim max-w-[16rem] truncate">
            {t.jarvis.model}: <span className="text-(--theme-jarvis-text-tech)">{model || provider}</span>
          </span>
        )}
        <span className="jarvis-tech jarvis-tech-dim hidden max-w-[14rem] truncate xl:inline" title={title}>
          {t.jarvis.session}: <span className="text-(--theme-jarvis-text-tech)">{title}</span>
        </span>
        {running && (
          <BeveledButton onClick={() => void onCancel()} size="xs" type="button" variant="solid">
            {t.jarvis.interrupt}
          </BeveledButton>
        )}
        <BeveledButton onClick={() => navigate(NEW_CHAT_ROUTE)} size="xs" type="button">
          {t.jarvis.newSession}
        </BeveledButton>
      </span>
    </div>
  )
}

// Live transcript captions. Isolated so the ~30fps $messages churn during a
// stream never re-renders the orb (its parent).
function CockpitCaptions({ onDismissError }: { onDismissError?: (messageId: string) => void }) {
  const { t } = useI18n()
  const messages = useStore($messages)
  const liveVoiceTranscript = useStore($liveVoiceTranscript)

  let userLine = ''
  let userPending = false
  let assistantLine = ''
  let assistantPending = false
  let errorId = ''
  let errorText = ''

  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]

    if (message.hidden) {
      continue
    }

    if (!errorText && message.error) {
      errorId = message.id
      errorText = message.error
    }

    if (!assistantLine && message.role === 'assistant') {
      assistantLine = chatMessageText(message).trim()
      assistantPending = Boolean(message.pending)

      continue
    }

    if (!userLine && message.role === 'user') {
      userLine = chatMessageText(message).trim()

      break
    }
  }

  const liveLine = liveVoiceTranscript.trim()

  if (liveLine) {
    userLine = liveLine
    userPending = true
  }

  if (!userLine && !assistantLine && !errorText) {
    return (
      <p aria-live="polite" className="jarvis-tech jarvis-tech-dim text-center">
        {t.jarvis.emptyPrompt}
      </p>
    )
  }

  return (
    <div aria-live="polite" className="mx-auto flex max-w-[46rem] flex-col items-center gap-2 text-center">
      {userLine && <p className="line-clamp-2 text-[0.8125rem] text-(--theme-jarvis-text-dim)">{userLine}</p>}
      {userLine && userPending && (
        <span className="jarvis-tech jarvis-tech-dim text-[0.6875rem]">{t.composer.listening}</span>
      )}
      {assistantLine && (
        <p className="line-clamp-4 text-[0.95rem] leading-relaxed text-(--theme-jarvis-text-tech)">
          {assistantLine}
          {assistantPending && (
            <span
              aria-hidden
              className="ml-1 inline-block h-4 w-1 animate-pulse rounded-full bg-current align-[-0.15em]"
            />
          )}
        </p>
      )}
      {errorText && (
        <div
          className="mt-1 flex max-w-full items-start gap-2 rounded-md border border-[color-mix(in_srgb,var(--theme-orb-error)_42%,transparent)] bg-[color-mix(in_srgb,var(--theme-orb-error)_10%,transparent)] px-3 py-2 text-left text-[0.8125rem] leading-5 text-[color-mix(in_srgb,var(--theme-orb-error)_80%,var(--theme-jarvis-text-tech))]"
          role="alert"
        >
          <Codicon className="mt-0.5 shrink-0" name="warning" size="0.875rem" />
          <span className="min-w-0 flex-1 break-words">{errorText}</span>
          {onDismissError && (
            <button
              aria-label={t.assistant.thread.dismissError}
              className="-mr-1 grid size-5 shrink-0 place-items-center rounded text-current opacity-70 transition-opacity hover:opacity-100"
              onClick={() => onDismissError(errorId)}
              type="button"
            >
              <Codicon name="close" size="0.75rem" />
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// How many of the current turn's tool calls the feed shows at once — enough
// to follow multi-step work without covering the orb.
const TOOL_FEED_MAX_ROWS = 4

function toolStatusIcon(status: string): string {
  if (status === 'running') {
    return 'loading'
  }

  if (status === 'error' || status === 'warning') {
    return 'warning'
  }

  return 'check'
}

// The current turn's tool calls as a feed (not just the latest one), so
// commands and their progress are visible from the voice screen exactly like
// they are in the chat thread. Settled feeds linger briefly, then clear.
function CockpitToolActivity() {
  const { t } = useI18n()
  const messages = useStore($messages)

  const activities = useMemo<ToolActivityModel[]>(() => currentTurnToolActivities(messages), [messages])
  // Signature keeps the hide-timer effect from restarting on every streamed
  // token — it only reacts when a tool call appears or changes status.
  const signature = activities.map(activity => `${activity.id}:${activity.view.status}`).join('|')
  const running = activities.some(activity => activity.view.status === 'running')
  const [visible, setVisible] = useState(activities.length > 0)

  useEffect(() => {
    if (!signature) {
      setVisible(false)

      return
    }

    setVisible(true)

    if (running) {
      return
    }

    const timeout = window.setTimeout(() => setVisible(false), TOOL_ACTIVITY_SETTLED_TTL_MS)

    return () => window.clearTimeout(timeout)
  }, [signature, running])

  if (!visible || !activities.length) {
    return null
  }

  const shown = activities.slice(-TOOL_FEED_MAX_ROWS)
  const hiddenCount = activities.length - shown.length

  return (
    <section
      aria-label={t.jarvis.toolActivity}
      className="mx-auto flex w-full max-w-[46rem] flex-col gap-1.5 rounded-md border border-[color-mix(in_srgb,var(--theme-jarvis-stroke)_78%,transparent)] bg-[linear-gradient(180deg,color-mix(in_srgb,#fff_5%,transparent),transparent),color-mix(in_srgb,var(--theme-jarvis-panel)_78%,#02040a)] px-3 py-2 shadow-[inset_0_0.0625rem_0_color-mix(in_srgb,#fff_7%,transparent),0_0_1.5rem_color-mix(in_srgb,var(--theme-orb-glow)_10%,transparent)]"
    >
      {hiddenCount > 0 && <span className="jarvis-tech jarvis-tech-dim text-[0.6875rem]">+{hiddenCount}</span>}
      {shown.map(activity => (
        <div className="flex items-center gap-3" key={activity.id}>
          <Codicon
            className={cn(
              activity.view.status === 'running' ? 'text-(--theme-orb-ring)' : 'text-(--theme-jarvis-text-dim)'
            )}
            name={toolStatusIcon(activity.view.status)}
            size="0.875rem"
          />
          <div className="flex min-w-0 flex-1 items-baseline gap-2">
            <p
              className={cn(
                'jarvis-tech shrink-0',
                activity.view.status === 'running' ? 'text-(--theme-jarvis-text-tech)' : 'jarvis-tech-dim'
              )}
            >
              {activity.view.title}
            </p>
            {activity.view.subtitle && (
              <p className="truncate text-[0.75rem] text-(--theme-jarvis-text-dim)">{activity.view.subtitle}</p>
            )}
          </div>
          {activity.view.countLabel && <span className="jarvis-tech jarvis-tech-dim">{activity.view.countLabel}</span>}
        </div>
      ))}
    </section>
  )
}

/**
 * The J.A.R.V.I.S orb cockpit - the default `/` surface. Renders in place of the
 * scrolling thread (the real composer stays mounted below it), reading orb state
 * and live levels from existing gateway/session/voice stores.
 */
export function JarvisCockpit({
  onCancel,
  onDismissError
}: {
  onCancel: () => Promise<void> | void
  onDismissError?: (messageId: string) => void
}) {
  const { t } = useI18n()
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)')
  const state = useOrbState()

  return (
    <div className="jarvis-stage absolute inset-0 flex flex-col">
      <CockpitTopStrip onCancel={onCancel} />

      {/* The orb itself renders in JarvisOrbBackdrop, a fixed full-viewport
          layer mounted once at the shell root - this spacer just reserves the
          same vertical rhythm so the top strip and caption stack keep their
          original position over it. */}
      <div className="min-h-0 flex-1" />

      <div
        className="relative z-10 flex flex-col items-center gap-4 px-6"
        style={{ paddingBottom: 'calc(var(--composer-measured-height, 4rem) + 1rem)' }}
      >
        <span className="jarvis-tech flex items-center gap-2 text-(--theme-orb-ring)">
          <span
            className={cn('size-1.5 rounded-full bg-current', !reducedMotion && state !== 'idle' && 'animate-pulse')}
          />
          {t.jarvis.status[state]}
        </span>

        <CockpitCaptions onDismissError={onDismissError} />
        <CockpitToolActivity />
      </div>
    </div>
  )
}
