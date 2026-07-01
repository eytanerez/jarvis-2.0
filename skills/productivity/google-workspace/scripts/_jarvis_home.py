"""Resolve JARVIS_HOME for standalone skill scripts.

Skill scripts may run outside the Jarvis process (e.g. system Python,
nix env, CI) where ``jarvis_constants`` is not importable.  This module
provides the same ``get_jarvis_home()`` and ``display_jarvis_home()``
contracts as ``jarvis_constants`` without requiring it on ``sys.path``.

When ``jarvis_constants`` IS available it is used directly so that any
future enhancements (profile resolution, Docker detection, etc.) are
picked up automatically.  The fallback path replicates the core logic
from ``jarvis_constants.py`` using only the stdlib.

All scripts under ``google-workspace/scripts/`` should import from here
instead of duplicating the ``JARVIS_HOME = Path(os.getenv(...))`` pattern.
"""

from __future__ import annotations

import os
from pathlib import Path

try:
    from jarvis_constants import display_jarvis_home as display_jarvis_home
    from jarvis_constants import get_jarvis_home as get_jarvis_home
except (ModuleNotFoundError, ImportError):

    def get_jarvis_home() -> Path:
        """Return the Jarvis home directory (default: ~/.jarvis).

        Mirrors ``jarvis_constants.get_jarvis_home()``."""
        val = os.environ.get("JARVIS_HOME", "").strip()
        return Path(val) if val else Path.home() / ".jarvis"

    def display_jarvis_home() -> str:
        """Return a user-friendly ``~/``-shortened display string.

        Mirrors ``jarvis_constants.display_jarvis_home()``."""
        home = get_jarvis_home()
        try:
            return "~/" + str(home.relative_to(Path.home()))
        except ValueError:
            return str(home)
