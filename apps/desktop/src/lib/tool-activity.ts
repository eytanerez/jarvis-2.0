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

