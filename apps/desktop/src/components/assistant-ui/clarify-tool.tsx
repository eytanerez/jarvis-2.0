'use client'

import { type ToolCallMessagePartProps } from '@assistant-ui/react'
import { useStore } from '@nanostores/react'
import { type ComponentProps, type FormEvent, type KeyboardEvent, useCallback, useMemo, useRef, useState } from 'react'

import { ToolFallback } from '@/components/assistant-ui/tool-fallback'
import { Button } from '@/components/ui/button'
import { KbdCombo } from '@/components/ui/kbd'
import { Textarea } from '@/components/ui/textarea'
import { useI18n } from '@/i18n'
import { triggerHaptic } from '@/lib/haptics'
import { Check, HelpCircle, Loader2 } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { $clarifyRequest, clearClarifyRequest } from '@/store/clarify'
import { $gateway } from '@/store/gateway'
import { notifyError } from '@/store/notifications'

interface ClarifyArgs {
  question?: string
  choices?: string[] | null
}

function readClarifyArgs(args: unknown): ClarifyArgs {
  if (!args || typeof args !== 'object') {
    return {}
  }

  const row = args as Record<string, unknown>
  const choices = Array.isArray(row.choices) ? row.choices.filter((c): c is string => typeof c === 'string') : null

  return {
    question: typeof row.question === 'string' ? row.question : undefined,
    choices: choices && choices.length > 0 ? choices : null
  }
}

// Choice and "Other" rows share a layout; only color/hover differs.
const OPTION_ROW_CLASS =
  'flex w-full items-start gap-2 rounded-md px-2.5 py-1.5 text-left text-sm transition-[border-color,background-color,color,transform] duration-150'

const CLARIFY_SHELL_CLASS =
  'relative mb-3 mt-2 rounded-md border border-[color-mix(in_srgb,var(--jarvis-blue)_28%,var(--jarvis-hairline))] bg-[color-mix(in_srgb,var(--jarvis-panel)_86%,transparent)] text-sm shadow-[0_0_28px_color-mix(in_srgb,var(--jarvis-blue)_9%,transparent),inset_0_1px_0_color-mix(in_srgb,var(--jarvis-blue)_8%,transparent)]'

function ClarifyShell({ children, className, ...props }: ComponentProps<'div'>) {
  return (
    <div className={cn(CLARIFY_SHELL_CLASS, className)} data-slot="clarify-inline" {...props}>
      <span aria-hidden className="arc-border" />
      {children}
    </div>
  )
}

function RadioDot({ selected }: { selected: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        'mt-0.5 grid size-3.5 shrink-0 place-items-center rounded-full border transition-colors',
        selected
          ? 'border-(--jarvis-blue) bg-[color-mix(in_srgb,var(--jarvis-blue)_12%,transparent)]'
          : 'border-[color-mix(in_srgb,var(--jarvis-muted)_42%,transparent)]'
      )}
    >
      {selected && <span className="size-1.5 rounded-full bg-(--jarvis-blue)" />}
    </span>
  )
}

export const ClarifyTool = (props: ToolCallMessagePartProps) => {
  const isPending = props.result === undefined

  // Once Jarvis records an answer, fall back to the standard tool block so
  // the past Q/A renders consistently with every other tool in the thread.
  if (!isPending) {
    return <ToolFallback {...props} />
  }

  return <ClarifyToolPending {...props} />
}

function ClarifyToolPending({ args }: ToolCallMessagePartProps) {
  const { t } = useI18n()
  const copy = t.assistant.clarify
  const request = useStore($clarifyRequest)
  const gateway = useStore($gateway)
  const fromArgs = useMemo(() => readClarifyArgs(args), [args])

  const matchingRequest = useMemo(() => {
    if (!request) {
      return null
    }

    if (fromArgs.question && request.question && fromArgs.question !== request.question) {
      return null
    }

    return request
  }, [fromArgs.question, request])

  const question = fromArgs.question || matchingRequest?.question || ''

  const choices = useMemo(
    () => fromArgs.choices ?? matchingRequest?.choices ?? [],
    [fromArgs.choices, matchingRequest?.choices]
  )

  const hasChoices = choices.length > 0

  const [typing, setTyping] = useState(false)
  const [draft, setDraft] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [selectedChoice, setSelectedChoice] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  // Race: tool.start fires a tick before clarify.request, so request_id
  // arrives slightly after the tool block mounts. Hold the whole panel on a
  // spinner until the gateway request is wired — showing disabled choices or
  // a "loading question" stub is worse than a brief wait.
  const ready = Boolean(matchingRequest?.requestId)
  const loading = !ready && !submitting

  const respond = useCallback(
    async (answer: string) => {
      if (!ready || !matchingRequest) {
        notifyError(new Error(copy.notReady), copy.sendFailed)

        return
      }

      if (!gateway) {
        notifyError(new Error(copy.gatewayDisconnected), copy.sendFailed)

        return
      }

      setSubmitting(true)

      try {
        await gateway.request<{ ok?: boolean }>('clarify.respond', {
          request_id: matchingRequest.requestId,
          answer
        })
        triggerHaptic('submit')
        clearClarifyRequest(matchingRequest.requestId, matchingRequest.sessionId)
        // The matching tool.complete will land shortly after, swapping this
        // panel for the ToolFallback view above.
      } catch (error) {
        notifyError(error, copy.sendFailed)
        setSubmitting(false)
      }
    },
    [copy.gatewayDisconnected, copy.notReady, copy.sendFailed, gateway, matchingRequest, ready]
  )

  const handleTextareaKey = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.nativeEvent.isComposing) {
        return
      }

      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault()
        const trimmed = draft.trim()

        if (trimmed) {
          void respond(trimmed)
        }
      }
    },
    [draft, respond]
  )

  const handleSubmitFreeform = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      const trimmed = draft.trim()

      if (trimmed) {
        void respond(trimmed)
      }
    },
    [draft, respond]
  )

  if (loading) {
    return (
      <ClarifyShell
        aria-label={copy.loadingQuestion}
        className="grid min-h-24 place-items-center px-3 py-6"
        role="status"
      >
        <Loader2 aria-hidden className="size-5 animate-spin text-(--jarvis-muted)" />
      </ClarifyShell>
    )
  }

  return (
    <ClarifyShell className="grid gap-6 px-3 py-2.5">
      <div className="flex items-start gap-2.5">
        <span
          aria-hidden
          className="mt-px grid size-6 shrink-0 place-items-center rounded-md border border-[color-mix(in_srgb,var(--jarvis-blue)_28%,transparent)] bg-[color-mix(in_srgb,var(--jarvis-blue)_12%,transparent)] text-(--jarvis-blue)"
        >
          <HelpCircle className="size-3.5" />
        </span>
        <span className="flex-1 whitespace-pre-wrap font-medium leading-snug text-(--jarvis-text)">{question}</span>
      </div>

      {!typing && hasChoices && (
        <div className="grid gap-0.5" role="group">
          {choices.map((choice, index) => (
            <button
              className={cn(
                OPTION_ROW_CLASS,
                'border border-transparent text-(--jarvis-text) hover:border-[color-mix(in_srgb,var(--jarvis-blue)_22%,transparent)] hover:bg-[color-mix(in_srgb,var(--jarvis-blue)_10%,transparent)] hover:text-white disabled:cursor-not-allowed disabled:opacity-55',
                selectedChoice === choice &&
                  'border-[color-mix(in_srgb,var(--jarvis-blue)_34%,transparent)] bg-[color-mix(in_srgb,var(--jarvis-blue)_12%,transparent)] text-white'
              )}
              data-choice
              disabled={submitting}
              key={`${index}-${choice}`}
              onClick={() => {
                setSelectedChoice(choice)
                void respond(choice)
              }}
              type="button"
            >
              <RadioDot selected={selectedChoice === choice} />
              <span className="flex-1 wrap-anywhere">{choice}</span>
              {selectedChoice === choice && (
                <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-(--jarvis-blue)" />
              )}
            </button>
          ))}
          <button
            className={cn(
              OPTION_ROW_CLASS,
              'border border-transparent text-(--jarvis-muted) hover:border-[color-mix(in_srgb,var(--jarvis-blue)_20%,transparent)] hover:bg-[color-mix(in_srgb,var(--jarvis-blue)_8%,transparent)] hover:text-white'
            )}
            disabled={submitting}
            onClick={() => {
              setTyping(true)
              window.setTimeout(() => textareaRef.current?.focus({ preventScroll: true }), 0)
            }}
            type="button"
          >
            <RadioDot selected={false} />
            <span className="flex-1">{copy.other}</span>
          </button>
        </div>
      )}

      {(typing || !hasChoices) && (
        <form className="grid gap-2" onSubmit={handleSubmitFreeform}>
          <Textarea
            className="desktop-input-chrome min-h-20 resize-y rounded-md text-sm"
            disabled={submitting}
            onChange={event => setDraft(event.target.value)}
            onKeyDown={handleTextareaKey}
            placeholder={copy.placeholder}
            ref={textareaRef}
            value={draft}
          />
          <div className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1 text-[0.6875rem] text-muted-foreground/85">
              <KbdCombo combo="enter" size="sm" />
              <KbdCombo combo="shift+enter" size="sm" />
              {t.composer.hotkeyDescs['composer.sendNewline']}
            </span>
            <div className="flex items-center gap-1.5">
              {hasChoices && (
                <Button
                  disabled={submitting}
                  onClick={() => {
                    setTyping(false)
                    setDraft('')
                  }}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  {copy.back}
                </Button>
              )}
              <Button disabled={submitting} onClick={() => void respond('')} size="sm" type="button" variant="ghost">
                {copy.skip}
              </Button>
              <Button disabled={submitting || !draft.trim()} size="sm" type="submit">
                {submitting ? <Loader2 className="size-3.5 animate-spin" /> : copy.send}
              </Button>
            </div>
          </div>
        </form>
      )}

      {!typing && hasChoices && (
        <div className="flex justify-end">
          <Button
            className="-mr-2"
            disabled={submitting}
            onClick={() => void respond('')}
            size="xs"
            type="button"
            variant="text"
          >
            {copy.skip}
          </Button>
        </div>
      )}
    </ClarifyShell>
  )
}
