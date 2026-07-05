#!/usr/bin/env python3
"""End-conversation signal for voice mode.

Voice clients (the iOS app's tap-to-talk loop, and eventually the desktop
voice loop) keep listening after a reply unless something says the exchange
is over. The old heuristic — "end unless the reply ends with '?'" — guessed
wrong in both directions. This tool moves that decision to the model, which
has the full conversational context.

The tool body is deliberately a no-op: the signal is the tool CALL itself.
Voice clients watch the live event stream for a tool named
``end_conversation`` and hang up the mic when they see it. Outside voice
mode the call is harmless.

The spoken-reply cue (brain/persona_cue.py, applied to voice turns only)
tells the model when to call this.
"""

import json


def end_conversation_tool() -> str:
    """Acknowledge the signal; the client reacts to the call event itself."""
    return json.dumps(
        {"ok": True, "note": "Conversation-end signal sent to the voice client."},
        ensure_ascii=False,
    )


def check_end_conversation_requirements() -> bool:
    """No external requirements — always available."""
    return True


END_CONVERSATION_SCHEMA = {
    "name": "end_conversation",
    "description": (
        "Voice conversations only: signal that the spoken exchange is "
        "complete. Call this AFTER your final spoken reply when you need "
        "nothing further from the user — it is what hangs up the microphone. "
        "Do NOT call it when you asked the user a question or a reply is "
        "naturally expected; leaving it uncalled keeps the mic listening for "
        "their next turn. Outside voice mode this is a no-op."
    ),
    "parameters": {"type": "object", "properties": {}, "required": []},
}


# --- Registry ---
from tools.registry import registry

registry.register(
    name="end_conversation",
    toolset="clarify",
    schema=END_CONVERSATION_SCHEMA,
    handler=lambda args, **kw: end_conversation_tool(),
    check_fn=check_end_conversation_requirements,
    emoji="👋",
)
