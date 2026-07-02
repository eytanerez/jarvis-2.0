#!/usr/bin/env python3
"""Timer tool.

The model-facing tool returns a structured timer intent. Desktop clients can
observe the completed tool call and project it into native UI, such as Jarvis
Notch's timer surface.
"""

import json
from typing import Any

from tools.registry import registry


def _number(value: Any) -> float | None:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return result if result > 0 else None


def set_timer_tool(duration_seconds: Any, label: str | None = None) -> str:
    seconds = _number(duration_seconds)
    if seconds is None:
        return json.dumps({"error": "duration_seconds must be a positive number"})

    safe_seconds = int(round(seconds))
    safe_label = (label or "Jarvis Timer").strip() or "Jarvis Timer"

    return json.dumps(
        {
            "duration_seconds": safe_seconds,
            "label": safe_label,
            "success": True,
        }
    )


SET_TIMER_SCHEMA = {
    "name": "set_timer",
    "description": (
        "Set a timer for the user. Use this when the user asks to start, set, "
        "or create a countdown timer. The desktop app mirrors successful calls "
        "into the native Jarvis Notch timer UI when available."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "duration_seconds": {
                "type": "number",
                "description": "Timer duration in seconds. Convert minutes or hours before calling.",
            },
            "label": {
                "type": "string",
                "description": "Optional short timer label, such as Tea or Laundry.",
            },
        },
        "required": ["duration_seconds"],
    },
}


registry.register(
    name="set_timer",
    toolset="timer",
    schema=SET_TIMER_SCHEMA,
    handler=lambda args, **kw: set_timer_tool(
        duration_seconds=args.get("duration_seconds"),
        label=args.get("label"),
    ),
    emoji="timer",
)
