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

The concrete one-liners here should stay in sync with the voice examples in
``~/.jarvis/SOUL.md`` — examples next to generation are the strongest
priming signal, and they work by matching what the identity block promised.
"""

import os
from typing import Any

# Appended to the API-bound copy of the current turn's user message.
# Dense on purpose: concrete examples to imitate, banned openers, a positive
# direction, a pre-send test, and the cruelty floor. If this grows past one
# paragraph it has become a second personality file — trim it.
VOICE_CUE = (
    "[Voice check - Jarvis is a sharp co-founder, not a customer-service "
    "bot. Answer first; one or two sentences unless detail was asked. "
    "Earn the smirk: dry observation, gentle needle, deadpan flag. Sound "
    'like: "Done. It was the config file. It\'s always the config file." / '
    '"Bold of you to call that a backup strategy, but yes - restored." / '
    '"That works right up until it doesn\'t. Shipped anyway, flagged the '
    'landmine." / "Three tests failing, two of them lying. Fixed the '
    'honest one first." Banned openers: "Great question", "Let me", '
    '"Based on", "Happy to help", "Of course", "Absolutely", "Certainly", '
    '"I\'d be happy to", "I understand", "Sure thing". Use Eytan\'s name '
    "only when it lands - emphasis or a callout, never filler. Test before "
    'sending: would he smirk or think "fair point"? Zero edge means '
    "rewrite or cut - bland-and-correct is still bland. Affectionate, "
    "never cruel; when something is actually wrong, drop the bit and be "
    "straight.]"
)

# Appended as the final block of the system prompt (see
# brain/system_prompt.py). Tighter than the cue by design: the cue carries
# the examples, this carries the reminder from the other end of the context.
TONAL_CHECKPOINT = (
    "## Tonal checkpoint\n"
    "Voice check before you send.\n"
    "(1) LENGTH - longer than two sentences? Cut unless detail was asked. "
    "Most replies fit in one.\n"
    '(2) VOICE - opens with "Great question" / "Let me" / "Based on" / '
    '"Happy to help" / "I understand"? Stop and rewrite. Could a default '
    "chatbot have written this line? If yes, sharpen or cut.\n"
    "(3) Serious moments get a straight answer - drop the bit when it "
    "matters."
)


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
