"""Persona persistence layers — recency voice cue + system tonal checkpoint.

Long conversations drift toward generic-assistant mode because the model's
own recent replies outweigh the personality block at the top of the system
prompt. The fix is positional, not motivational: put a short voice cue
*after* the assistant's recent turns (appended to the API-bound copy of the
current turn's user message — never stored), and a matching checkpoint at
the very end of the system prompt, so the persona is enforced from both
ends of the context window.

Cache invariants this module respects:
  * The cue rides only on the per-call ``api_messages`` copy built in
    ``brain/conversation_loop.py`` — stored history and the SessionDB never
    see it, so it can't compound across the transcript.
  * ``TONAL_CHECKPOINT`` is static text — appended to the system prompt it
    stays byte-stable across turns, so the once-per-session prompt cache
    contract in ``brain/system_prompt.py`` is preserved.

Scope: interactive chat/voice sessions only. Dispatched work (cron, batch
runner, delegate tool, curator, kanban workers) keeps a neutral voice —
gated via ``skip_context_files`` and the kanban env marker below.

The concrete examples here should stay in sync with the voice examples in
``~/.jarvis/SOUL.md`` — examples next to generation are the strongest
priming signal, and they work by matching what the identity block promised.
"""

import os
from typing import Any

# Appended to the API-bound copy of the current turn's user message.
# Dense on purpose: concrete examples to imitate, banned openers, a positive
# direction, and a pre-send test. If this grows past one paragraph it has
# become a second personality file — trim it.
VOICE_CUE = (
    "[Voice check - be direct, plain, and useful. Do what Eytan asked; "
    "answer first; keep it concise unless detail is needed. No forced jokes, "
    "no pretend edge, no fake meanness, no customer-service padding. Sound "
    'like: "Done. I updated the setting and verified the new session opens '
    'in orb mode." / "I found the drop: the renderer never forwarded the '
    'completed timer tool call. Fixed that path and added a test." / "This '
    'part is not verified yet: it needs a manual macOS Space/focus check." '
    'Banned openers: "Great question", "Let me", "Based on", "Happy to '
    'help", "Of course", "Absolutely", "Certainly", "I\'d be happy to", '
    '"I understand", "Sure thing". Use Eytan\'s name only when it clarifies '
    "or emphasizes something, never as filler. Before sending: is this the "
    "shortest truthful answer that moves the work forward? If not, cut it.]"
)

# Appended as the final block of the system prompt (see
# brain/system_prompt.py). Tighter than the cue by design: the cue carries
# the examples, this carries the reminder from the other end of the context.
TONAL_CHECKPOINT = (
    "## Tonal checkpoint\n"
    "Voice check before you send.\n"
    "(1) LENGTH - keep it short unless detail was asked or the work needs "
    "a real status report.\n"
    '(2) VOICE - opens with "Great question" / "Let me" / "Based on" / '
    '"Happy to help" / "I understand"? Stop and rewrite. Does it sound like '
    "performance, forced humor, or pretend attitude? Cut it.\n"
    "(3) Be concrete: say what changed, what is verified, and what is still "
    "uncertain."
)


# Appended to the API-bound copy of the current turn's user message when the
# turn arrived via the desktop voice loop (gateway sets
# ``agent._voice_turn_active`` per turn from prompt.submit's ``voice`` flag).
# The reply is read aloud by TTS sentence-by-sentence, so long formatted
# answers are both slow to hear and unpleasant — this asks for speech-shaped
# output without changing what the agent actually does.
SPOKEN_REPLY_CUE = (
    "[Voice turn - the user spoke this aloud and your reply will be read "
    "out by text-to-speech. Answer the way you would speak: lead with the "
    "answer, keep it to a few short sentences, plain conversational words. "
    "No markdown, no bullet lists, no headings, no code blocks, no tables. "
    "If the work genuinely produced details worth reading, keep the spoken "
    "reply to a sentence or two and say the rest is in the chat.]"
)


def append_spoken_reply_cue(content: str) -> str:
    """Return ``content`` with the spoken-reply cue appended (idempotent).

    Same contract as :func:`append_voice_cue`: string content only, applied
    to the API-bound copy of a message, never to stored history.
    """
    if SPOKEN_REPLY_CUE in content:
        return content
    return f"{content}\n\n{SPOKEN_REPLY_CUE}"


def should_apply_persona_cue(agent: Any) -> bool:
    """Whether this session gets the persona push.

    True for interactive chat/voice sessions; False for dispatched work
    (``skip_context_files`` is set by exactly those entry points: cron,
    batch runner, delegate tool, curator, feishu comments), for kanban
    workers, and when the user disabled it via config.yaml
    ``agent.persona_cue: false``.
    """
    if not getattr(agent, "_persona_cue_enabled", True):
        return False
    if getattr(agent, "skip_context_files", False):
        return False
    if os.environ.get("JARVIS_KANBAN_TASK"):
        return False
    return True


def append_voice_cue(content: str) -> str:
    """Return ``content`` with the voice cue appended.

    Callers must pass string content only (tool_result rounds carry
    block-list content — skip those) and must only call this on the
    API-bound copy of a message, never on stored history.
    """
    if VOICE_CUE in content:
        # Defensive: a stored message that somehow already carries the cue
        # (e.g. replayed API copy) must not accumulate a second one.
        return content
    return f"{content}\n\n{VOICE_CUE}"
