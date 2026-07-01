import { useStore } from '@nanostores/react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { NEW_CHAT_ROUTE } from '@/app/routes'
import { buildToolView, type ToolPart } from '@/components/assistant-ui/tool-fallback-model'
import { BeveledButton } from '@/components/chrome/beveled-button'
import { Codicon } from '@/components/ui/codicon'
import { useMediaQuery } from '@/hooks/use-media-query'
import { useI18n } from '@/i18n'
import type { ChatMessagePart } from '@/lib/chat-messages'
import { chatMessageText } from '@/lib/chat-messages'
import { sessionTitle } from '@/lib/chat-runtime'
import { cn } from '@/lib/utils'
import { useOrbState } from '@/store/jarvis-cockpit'
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
import { getToolDiff } from '@/store/tool-diffs'

const TOOL_ACTIVITY_SETTLED_TTL_MS = 7_000

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
    <div className="relative z-10 mt-(--titlebar-height) flex items-center gap-4 border-b border-[color-mix(in_srgb,var(--theme-jarvis-stroke)_46%,transparent)] bg-[linear-gradient(180deg,color-mix(in_srgb,var(--theme-jarvis-panel)_46%,transparent),transparent)] px-5 py-3 backdrop-blur-[0.375rem]">
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

  let userLine = ''
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

function asToolPart(part: ChatMessagePart): ToolPart | null {
  if (part.type !== 'tool-call') {
    return null
  }

  const record = part as ChatMessagePart & Partial<ToolPart>

  return {
    args: record.args,
    isError: Boolean(record.isError),
    result: record.result,
    toolCallId: typeof record.toolCallId === 'string' ? record.toolCallId : undefined,
    toolName: typeof record.toolName === 'string' ? record.toolName : 'tool',
    type: 'tool-call'
  }
}

interface CockpitToolActivityModel {
  id: string
  view: ReturnType<typeof buildToolView>
}

function CockpitToolActivity() {
  const { t } = useI18n()
  const messages = useStore($messages)

  const latestActivity = useMemo<CockpitToolActivityModel | null>(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i]

      if (message.role !== 'assistant' || message.hidden) {
        continue
      }

      for (let j = message.parts.length - 1; j >= 0; j--) {
        const part = asToolPart(message.parts[j])

        if (!part) {
          continue
        }

        const view = buildToolView(part, part.toolCallId ? getToolDiff(part.toolCallId) : '')

        return { id: part.toolCallId || `${message.id}-${j}`, view }
      }
    }

    return null
  }, [messages])

  const [activity, setActivity] = useState<CockpitToolActivityModel | null>(latestActivity)

  useEffect(() => {
    if (!latestActivity) {
      setActivity(null)

      return
    }

    setActivity(latestActivity)

    if (latestActivity.view.status === 'running') {
      return
    }

    const timeout = window.setTimeout(() => {
      setActivity(current => (current?.id === latestActivity.id ? null : current))
    }, TOOL_ACTIVITY_SETTLED_TTL_MS)

    return () => window.clearTimeout(timeout)
  }, [latestActivity])

  if (!activity) {
    return null
  }

  const icon = activity.view.status === 'running' ? 'loading' : activity.view.status === 'error' ? 'warning' : 'check'

  return (
    <section
      aria-label={t.jarvis.toolActivity}
      className="mx-auto flex w-full max-w-[46rem] items-center gap-3 rounded-md border border-[color-mix(in_srgb,var(--theme-jarvis-stroke)_78%,transparent)] bg-[linear-gradient(180deg,color-mix(in_srgb,#fff_5%,transparent),transparent),color-mix(in_srgb,var(--theme-jarvis-panel)_78%,#02040a)] px-3 py-2 shadow-[inset_0_0.0625rem_0_color-mix(in_srgb,#fff_7%,transparent),0_0_1.5rem_color-mix(in_srgb,var(--theme-orb-glow)_10%,transparent)]"
    >
      <Codicon className="text-(--theme-orb-ring)" name={icon} size="0.875rem" />
      <div className="min-w-0 flex-1">
        <p className="jarvis-tech text-(--theme-jarvis-text-tech)">{activity.view.title}</p>
        {activity.view.subtitle && (
          <p className="truncate text-[0.75rem] text-(--theme-jarvis-text-dim)">{activity.view.subtitle}</p>
        )}
      </div>
      {activity.view.countLabel && <span className="jarvis-tech jarvis-tech-dim">{activity.view.countLabel}</span>}
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
