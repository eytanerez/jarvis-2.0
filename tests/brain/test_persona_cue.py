"""Structural tests for the persona-persistence layers (brain/persona_cue.py).

These prove the wiring contract from the personality-persistence design:
the cue is API-copy-only, appended once, skipped for dispatched work, and
carries both the ban-list and the positive direction plus the cruelty
guardrail. Whether the agent is actually funnier is judged in a live
conversation, not here.
"""

import pytest

from brain.persona_cue import (
    MOBILE_CUE,
    TONAL_CHECKPOINT,
    VOICE_CUE,
    append_mobile_cue,
    append_voice_cue,
    should_apply_persona_cue,
)


class FakeAgent:
    """Bare attribute bag mirroring the agent attrs the gate reads."""

    def __init__(self, persona_cue_enabled=True, skip_context_files=False):
        self._persona_cue_enabled = persona_cue_enabled
        self.skip_context_files = skip_context_files


@pytest.fixture(autouse=True)
def no_kanban_env(monkeypatch):
    monkeypatch.delenv("JARVIS_KANBAN_TASK", raising=False)


class TestGating:
    def test_interactive_session_gets_cue(self):
        assert should_apply_persona_cue(FakeAgent()) is True

    def test_config_flag_disables(self):
        assert should_apply_persona_cue(FakeAgent(persona_cue_enabled=False)) is False

    def test_dispatched_work_is_excluded(self):
        # skip_context_files is set by exactly the dispatched entry points
        # (cron, batch runner, delegate tool, curator) — those must keep a
        # neutral voice even with the config flag on.
        assert should_apply_persona_cue(FakeAgent(skip_context_files=True)) is False

    def test_kanban_worker_is_excluded(self, monkeypatch):
        monkeypatch.setenv("JARVIS_KANBAN_TASK", "task-123")
        assert should_apply_persona_cue(FakeAgent()) is False

    def test_agent_missing_attrs_defaults_to_enabled(self):
        # Code paths that bypass agent_init still get sane behavior.
        class Bare:
            pass

        assert should_apply_persona_cue(Bare()) is True


class TestAppendVoiceCue:
    def test_appends_cue_after_content(self):
        result = append_voice_cue("what's the weather")
        assert result.startswith("what's the weather")
        assert result.endswith(VOICE_CUE)

    def test_original_string_unmodified(self):
        # The caller passes the API-bound copy; strings are immutable, but
        # the contract is that append returns a NEW value rather than
        # touching anything shared.
        original = "hello"
        result = append_voice_cue(original)
        assert original == "hello"
        assert result != original

    def test_cue_never_doubles_up(self):
        once = append_voice_cue("hello")
        twice = append_voice_cue(once)
        assert twice.count(VOICE_CUE) == 1


class TestCueContent:
    """The cue must teach by contrast: bans AND a positive direction."""

    def test_contains_banned_openers(self):
        for phrase in ("Great question", "Happy to help", "I'd be happy to", "I understand"):
            assert phrase in VOICE_CUE

    def test_contains_positive_direction(self):
        # Not just a ban-list — the model needs something to aim at.
        # (Persona rewritten 2026-07-02 to the plain direct-assistant voice.)
        assert "be direct, plain, and useful" in VOICE_CUE

    def test_contains_concrete_voice_examples(self):
        # At least a few one-liners lifted from SOUL.md ride next to
        # generation — concrete examples are the strongest priming signal.
        assert "Done. I updated the setting" in VOICE_CUE
        assert "I found the drop" in VOICE_CUE

    def test_contains_no_performance_guardrail(self):
        # The old "never cruel" line became "no fake meanness" when the
        # persona dropped the snark entirely.
        assert "no fake meanness" in VOICE_CUE

    def test_contains_pre_send_test(self):
        assert "Before sending" in VOICE_CUE

    def test_stays_one_dense_block(self):
        # If the cue grows into a second personality file, it's riding on
        # every user message — keep it under ~1200 chars.
        assert len(VOICE_CUE) < 1200


class TestAppendMobileCue:
    def test_appends_cue_after_content(self):
        result = append_mobile_cue("open the calendar app")
        assert result.startswith("open the calendar app")
        assert result.endswith(MOBILE_CUE)

    def test_original_string_unmodified(self):
        original = "hello"
        result = append_mobile_cue(original)
        assert original == "hello"
        assert result != original

    def test_cue_never_doubles_up(self):
        once = append_mobile_cue("hello")
        twice = append_mobile_cue(once)
        assert twice.count(MOBILE_CUE) == 1

    def test_is_purely_informational_not_instructional(self):
        # Unlike VOICE_CUE/SPOKEN_REPLY_CUE, this must never ask for
        # different behavior — just state the fact and let the agent's own
        # judgment decide what, if anything, it implies.
        for word in ("keep it", "answer the way", "banned", "do not", "must"):
            assert word not in MOBILE_CUE.lower()


class TestTonalCheckpoint:
    def test_covers_length_and_voice_discipline(self):
        assert "LENGTH" in TONAL_CHECKPOINT
        assert "VOICE" in TONAL_CHECKPOINT

    def test_tighter_than_the_cue(self):
        # The cue carries the examples; the checkpoint is just the reminder
        # from the other end of the context window.
        assert len(TONAL_CHECKPOINT) < len(VOICE_CUE)

    def test_is_static_text(self):
        # Byte-stable across turns is what keeps the once-per-session
        # system prompt cache contract intact — no format placeholders.
        assert "{" not in TONAL_CHECKPOINT
