"""Tests for the voice-model warm-up helpers.

The desktop client fires ``POST /api/audio/warmup`` when a voice conversation
starts; these helpers must only ever load models for the *local* providers
(faster-whisper, Kokoro) and be a cheap no-op for everything else - a warm-up
must never hit a paid API or raise for a missing optional package.
"""

from unittest.mock import MagicMock, patch

import tools.transcription_tools as transcription_tools
import tools.tts_tool as tts_tool
from tools.transcription_tools import warm_up_stt
from tools.tts_tool import warm_up_tts


class TestWarmUpStt:
    def test_disabled_stt_is_noop(self):
        with patch.object(transcription_tools, "_load_stt_config", return_value={"enabled": False}):
            result = warm_up_stt()
        assert result["warmed"] is False
        assert result["reason"] == "stt disabled"

    def test_api_provider_is_noop(self):
        config = {"enabled": True, "provider": "openai"}
        with patch.object(transcription_tools, "_load_stt_config", return_value=config), \
             patch.object(transcription_tools, "_get_provider", return_value="openai"):
            result = warm_up_stt()
        assert result["warmed"] is False
        assert result["provider"] == "openai"

    def test_local_provider_loads_model(self, monkeypatch):
        config = {"enabled": True, "provider": "local", "local": {"model": "base"}}
        monkeypatch.setattr(transcription_tools, "_local_model", None)
        monkeypatch.setattr(transcription_tools, "_local_model_name", None)
        monkeypatch.setattr(transcription_tools, "_HAS_FASTER_WHISPER", True)
        loaded = MagicMock()

        with patch.object(transcription_tools, "_load_stt_config", return_value=config), \
             patch.object(transcription_tools, "_get_provider", return_value="local"), \
             patch.object(transcription_tools, "_load_local_whisper_model", return_value=loaded) as loader:
            result = warm_up_stt()

        assert result == {"warmed": True, "provider": "local", "reason": "loaded"}
        loader.assert_called_once()
        assert transcription_tools._local_model is loaded

    def test_local_provider_already_loaded_skips_load(self, monkeypatch):
        config = {"enabled": True, "provider": "local", "local": {"model": "base"}}
        model_name = transcription_tools._normalize_local_model("base")
        monkeypatch.setattr(transcription_tools, "_local_model", MagicMock())
        monkeypatch.setattr(transcription_tools, "_local_model_name", model_name)
        monkeypatch.setattr(transcription_tools, "_HAS_FASTER_WHISPER", True)

        with patch.object(transcription_tools, "_load_stt_config", return_value=config), \
             patch.object(transcription_tools, "_get_provider", return_value="local"), \
             patch.object(transcription_tools, "_load_local_whisper_model") as loader:
            result = warm_up_stt()

        assert result["warmed"] is True
        assert result["reason"] == "already loaded"
        loader.assert_not_called()

    def test_missing_faster_whisper_is_noop(self, monkeypatch):
        config = {"enabled": True, "provider": "local"}
        monkeypatch.setattr(transcription_tools, "_local_model", None)
        monkeypatch.setattr(transcription_tools, "_HAS_FASTER_WHISPER", False)

        with patch.object(transcription_tools, "_load_stt_config", return_value=config), \
             patch.object(transcription_tools, "_get_provider", return_value="local"), \
             patch.object(transcription_tools, "_try_lazy_install_stt", return_value=False):
            result = warm_up_stt()

        assert result["warmed"] is False
        assert result["reason"] == "faster-whisper not installed"


class TestWarmUpTts:
    def test_non_kokoro_provider_is_noop(self):
        with patch.object(tts_tool, "_load_tts_config", return_value={"provider": "edge"}), \
             patch.object(tts_tool, "_get_provider", return_value="edge"):
            result = warm_up_tts()
        assert result["warmed"] is False
        assert result["provider"] == "edge"

    def test_kokoro_not_installed_is_noop(self):
        with patch.object(tts_tool, "_load_tts_config", return_value={"provider": "kokoro"}), \
             patch.object(tts_tool, "_get_provider", return_value="kokoro"), \
             patch.object(tts_tool, "_check_kokoro_available", return_value=False):
            result = warm_up_tts()
        assert result["warmed"] is False
        assert result["reason"] == "kokoro-onnx not installed"

    def test_kokoro_cold_load_runs_tiny_synthesis(self, monkeypatch):
        monkeypatch.setattr(tts_tool, "_kokoro_model_cache", {})
        instance = MagicMock()
        kokoro_cls = MagicMock(return_value=instance)
        config = {"provider": "kokoro", "kokoro": {"voice": "af_heart"}}

        with patch.object(tts_tool, "_load_tts_config", return_value=config), \
             patch.object(tts_tool, "_get_provider", return_value="kokoro"), \
             patch.object(tts_tool, "_check_kokoro_available", return_value=True), \
             patch.object(tts_tool, "_import_kokoro", return_value=kokoro_cls), \
             patch.object(tts_tool, "_resolve_kokoro_assets", return_value=("model.onnx", "voices.bin")):
            result = warm_up_tts()

        assert result == {"warmed": True, "provider": "kokoro", "reason": "loaded"}
        kokoro_cls.assert_called_once_with("model.onnx", "voices.bin")
        # The throwaway synthesis is what forces ONNX Runtime's first-run
        # allocations - without it the first real sentence still pays them.
        instance.create.assert_called_once()
        assert tts_tool._kokoro_model_cache["model.onnx::voices.bin"] is instance

    def test_kokoro_already_loaded_skips_everything(self, monkeypatch):
        monkeypatch.setattr(
            tts_tool, "_kokoro_model_cache", {"model.onnx::voices.bin": MagicMock()}
        )
        kokoro_cls = MagicMock()

        with patch.object(tts_tool, "_load_tts_config", return_value={"provider": "kokoro"}), \
             patch.object(tts_tool, "_get_provider", return_value="kokoro"), \
             patch.object(tts_tool, "_check_kokoro_available", return_value=True), \
             patch.object(tts_tool, "_import_kokoro", return_value=kokoro_cls), \
             patch.object(tts_tool, "_resolve_kokoro_assets", return_value=("model.onnx", "voices.bin")):
            result = warm_up_tts()

        assert result["warmed"] is True
        assert result["reason"] == "already loaded"
        kokoro_cls.assert_not_called()
