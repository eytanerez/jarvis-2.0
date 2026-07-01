from __future__ import annotations

from run_brain import AIBrain


def _agent_with_base_url(base_url: str) -> AIBrain:
    agent = object.__new__(AIBrain)
    agent.base_url = base_url
    return agent


def test_direct_openai_url_requires_openai_host():
    agent = _agent_with_base_url("https://api.openai.com.example/v1")

    assert agent._is_direct_openai_url() is False


def test_direct_openai_url_ignores_path_segment_match():
    agent = _agent_with_base_url("https://proxy.example.test/api.openai.com/v1")

    assert agent._is_direct_openai_url() is False


def test_direct_openai_url_accepts_native_host():
    agent = _agent_with_base_url("https://api.openai.com/v1")

    assert agent._is_direct_openai_url() is True
