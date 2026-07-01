"""Tests that plugin context engines get update_model() called during init.

Regression test for #9071 — plugin engines were never initialized with
context_length, causing the CLI status bar to show 'ctx --'.
"""

from unittest.mock import MagicMock, patch

from brain.context_engine import ContextEngine


class _StubEngine(ContextEngine):
    """Minimal concrete context engine for testing."""

    @property
    def name(self) -> str:
        return "stub"

    def update_from_response(self, usage):
        pass

    def should_compress(self, prompt_tokens=None):
        return False

    def compress(self, messages, current_tokens=None):
        return messages


class _ToolEngine(_StubEngine):
    def get_tool_schemas(self):
        return [
            {
                "name": "stub_recover",
                "description": "Recover context from the stub engine.",
                "parameters": {"type": "object", "properties": {}},
            }
        ]


def test_plugin_engine_gets_context_length_on_init():
    """Plugin context engine should have context_length set during AIBrain init."""
    engine = _StubEngine()
    assert engine.context_length == 0  # ABC default before fix

    cfg = {"context": {"engine": "stub"}, "agent": {}}

    with (
        patch("jarvis_cli.config.load_config", return_value=cfg),
        patch("plugins.context_engine.load_context_engine", return_value=engine),
        patch("brain.model_metadata.get_model_context_length", return_value=204_800),
        patch("run_brain.get_tool_definitions", return_value=[]),
        patch("run_brain.check_toolset_requirements", return_value={}),
        patch("run_brain.OpenAI"),
    ):
        from run_brain import AIBrain

        agent = AIBrain(
            api_key="test-key-1234567890",
            base_url="https://openrouter.ai/api/v1",
            quiet_mode=True,
            skip_context_files=True,
            skip_memory=True,
        )

    assert agent.context_compressor is engine
    assert engine.context_length == 204_800
    assert engine.threshold_tokens == int(204_800 * engine.threshold_percent)


def test_active_context_engine_tools_survive_explicit_platform_toolsets():
    """LCM-style recovery tools must survive saved `jarvis tools` lists."""
    engine = _ToolEngine()
    cfg = {
        "context": {"engine": "stub"},
        "platform_toolsets": {"cli": ["web", "terminal"]},
        "agent": {},
    }

    from jarvis_cli.tools_config import _get_platform_tools

    enabled_toolsets = _get_platform_tools(cfg, "cli", include_default_mcp_servers=False)
    assert "context_engine" in enabled_toolsets

    with (
        patch("jarvis_cli.config.load_config", return_value=cfg),
        patch("plugins.context_engine.load_context_engine", return_value=engine),
        patch("brain.model_metadata.get_model_context_length", return_value=204_800),
        patch("run_brain.get_tool_definitions", return_value=[]),
        patch("run_brain.check_toolset_requirements", return_value={}),
        patch("run_brain.OpenAI"),
    ):
        from run_brain import AIBrain

        agent = AIBrain(
            api_key="test-key-1234567890",
            base_url="https://openrouter.ai/api/v1",
            enabled_toolsets=sorted(enabled_toolsets),
            quiet_mode=True,
            skip_context_files=True,
            skip_memory=True,
        )

    assert "stub_recover" in getattr(agent, "valid_tool_names", set())
    assert "stub_recover" in {
        tool.get("function", {}).get("name")
        for tool in getattr(agent, "tools", [])
    }


def test_plugin_engine_update_model_args():
    """Verify update_model() receives model, context_length, base_url, api_key, provider."""
    engine = _StubEngine()
    engine.update_model = MagicMock()

    cfg = {"context": {"engine": "stub"}, "agent": {}}

    with (
        patch("jarvis_cli.config.load_config", return_value=cfg),
        patch("plugins.context_engine.load_context_engine", return_value=engine),
        patch("brain.model_metadata.get_model_context_length", return_value=131_072),
        patch("run_brain.get_tool_definitions", return_value=[]),
        patch("run_brain.check_toolset_requirements", return_value={}),
        patch("run_brain.OpenAI"),
    ):
        from run_brain import AIBrain

        agent = AIBrain(
            model="openrouter/auto",
            api_key="test-key-1234567890",
            base_url="https://openrouter.ai/api/v1",
            quiet_mode=True,
            skip_context_files=True,
            skip_memory=True,
        )

    engine.update_model.assert_called_once()
    kw = engine.update_model.call_args.kwargs
    assert kw["context_length"] == 131_072
    assert "model" in kw
    assert "provider" in kw
    assert "api_mode" in kw
