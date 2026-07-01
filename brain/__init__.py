"""Agent internals -- extracted modules from run_brain.py.

These modules contain pure utility functions and self-contained classes
that were previously embedded in the 3,600-line run_brain.py. Extracting
them makes run_brain.py focused on the AIBrain orchestrator class.
"""

from . import jiter_preload as _jiter_preload  # noqa: F401
