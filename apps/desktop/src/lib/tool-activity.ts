import { buildToolView, type ToolPart } from '@/components/assistant-ui/tool-fallback-model'
import type { ChatMessage, ChatMessagePart } from '@/lib/chat-messages'
import { getToolDiff } from '@/store/tool-diffs'

export const TOOL_ACTIVITY_SETTLED_TTL_MS = 7_000

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

export interface ToolActivityModel {
  id: string
  view: ReturnType<typeof buildToolView>
}

/**
 * Every tool call of the current turn (the latest visible assistant
 * message), in execution order — the voice cockpit renders these as a feed
 * so tool work is visible outside the chat thread.
 */
export function currentTurnToolActivities(messages: ChatMessage[]): ToolActivityModel[] {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]

    if (message.role !== 'assistant' || message.hidden) {
      continue
    }

    const activities: ToolActivityModel[] = []

    for (let j = 0; j < message.parts.length; j++) {
      const part = asToolPart(message.parts[j])

      if (!part) {
        continue
      }

      const view = buildToolView(part, part.toolCallId ? getToolDiff(part.toolCallId) : '')

      activities.push({ id: part.toolCallId || `${message.id}-${j}`, view })
    }

    return activities
  }

  return []
}

export function latestToolActivity(messages: ChatMessage[]): ToolActivityModel | null {
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
}

