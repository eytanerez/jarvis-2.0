import json

from tools.timer_tool import set_timer_tool


def test_set_timer_tool_returns_structured_timer_intent():
    result = json.loads(set_timer_tool(30, "Tea"))

    assert result == {"duration_seconds": 30, "label": "Tea", "success": True}


def test_set_timer_tool_rejects_non_positive_duration():
    result = json.loads(set_timer_tool(0))

    assert "error" in result

