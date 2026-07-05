"""Tests for the Kokoro local provider in tools/tts_tool.py."""

import json
from unittest.mock import MagicMock, patch

import pytest


class _FakeSamples:
    def __init__(self, frames):
        self.frames = frames

    def astype(self, _dtype):
        return self

    def __mul__(self, _value):
        return self

    __rmul__ = __mul__

    def tobytes(self):
        return b"\0\0" * self.frames


class _FakeNumpy:
    float32 = "float32"
    int16 = "int16"

    @staticmethod
    def zeros(frames, dtype=None):
        return _FakeSamples(frames)

    @staticmethod
    def clip(samples, _min_value, _max_value):
        return samples


@pytest.fixture(autouse=True)
def clean_env(monkeypatch):
    for key in ("JARVIS_SESSION_PLATFORM",):
        monkeypatch.delenv(key, raising=False)


@pytest.fixture(autouse=True)
def clear_kokoro_cache():
    """Reset the module-level model cache between tests."""
    from tools import tts_tool as _tt
    _tt._kokoro_model_cache.clear()
    yield
    _tt._kokoro_model_cache.clear()


@pytest.fixture
def mock_kokoro_module(monkeypatch, tmp_path):
    """Inject a fake kokoro_onnx module and skip real asset resolution/download."""
    from tools import tts_tool as _tt

    fake_numpy = _FakeNumpy()
    fake_model = MagicMock()
    # 24kHz float32 PCM at ~1s of silence
    fake_model.create.return_value = (fake_numpy.zeros(24000, dtype=fake_numpy.float32), 24000)
    fake_cls = MagicMock(return_value=fake_model)
    fake_kokoro_onnx = MagicMock()
    fake_kokoro_onnx.Kokoro = fake_cls

    monkeypatch.setattr(
        _tt, "_resolve_kokoro_assets",
        lambda config: (str(tmp_path / "model.onnx"), str(tmp_path / "voices.bin")),
    )

    with patch.dict("sys.modules", {"kokoro_onnx": fake_kokoro_onnx, "numpy": fake_numpy}):
        yield fake_model, fake_cls


class TestGenerateKokoroTts:
    def test_successful_wav_generation(self, tmp_path, mock_kokoro_module):
        from tools.tts_tool import _generate_kokoro_tts

        fake_model, fake_cls = mock_kokoro_module
        output_path = str(tmp_path / "test.wav")
        result = _generate_kokoro_tts("Hello world", output_path, {})

        assert result == output_path
        assert (tmp_path / "test.wav").exists()
        fake_cls.assert_called_once()
        fake_model.create.assert_called_once()

    def test_config_passes_voice_speed_lang(self, tmp_path, mock_kokoro_module):
        from tools.tts_tool import _generate_kokoro_tts

        fake_model, _ = mock_kokoro_module
        config = {"kokoro": {"voice": "am_michael", "speed": 1.2, "lang": "en-gb"}}
        _generate_kokoro_tts("Hi there", str(tmp_path / "out.wav"), config)

        call_kwargs = fake_model.create.call_args.kwargs
        assert call_kwargs["voice"] == "am_michael"
        assert call_kwargs["speed"] == 1.2
        assert call_kwargs["lang"] == "en-gb"

    def test_default_voice_and_lang(self, tmp_path, mock_kokoro_module):
        from tools.tts_tool import (
            DEFAULT_KOKORO_LANG,
            DEFAULT_KOKORO_VOICE,
            _generate_kokoro_tts,
        )

        fake_model, _ = mock_kokoro_module
        _generate_kokoro_tts("Hi", str(tmp_path / "out.wav"), {})

        call_kwargs = fake_model.create.call_args.kwargs
        assert call_kwargs["voice"] == DEFAULT_KOKORO_VOICE
        assert call_kwargs["lang"] == DEFAULT_KOKORO_LANG

    def test_model_is_cached_across_calls(self, tmp_path, mock_kokoro_module):
        from tools.tts_tool import _generate_kokoro_tts

        _, fake_cls = mock_kokoro_module
        _generate_kokoro_tts("One", str(tmp_path / "a.wav"), {})
        _generate_kokoro_tts("Two", str(tmp_path / "b.wav"), {})

        # Same (model_path, voices_path) → Kokoro instantiated exactly once
        assert fake_cls.call_count == 1

    def test_non_wav_extension_triggers_ffmpeg_conversion(self, tmp_path, mock_kokoro_module, monkeypatch):
        """Non-.wav output path causes WAV → target ffmpeg conversion."""
        from tools import tts_tool as _tt

        calls = []

        def fake_shutil_which(cmd):
            return "/usr/bin/ffmpeg" if cmd == "ffmpeg" else None

        def fake_run(cmd, check=False, timeout=None, **kw):
            calls.append(cmd)
            import pathlib
            out_path = cmd[-1]
            pathlib.Path(out_path).write_bytes(b"fake-mp3-data")
            return MagicMock(returncode=0)

        monkeypatch.setattr(_tt.shutil, "which", fake_shutil_which)
        monkeypatch.setattr(_tt.subprocess, "run", fake_run)

        output_path = str(tmp_path / "test.mp3")
        result = _tt._generate_kokoro_tts("Hi", output_path, {})

        assert result == output_path
        assert len(calls) == 1
        assert calls[0][0] == "/usr/bin/ffmpeg"

    def test_missing_kokoro_onnx_raises_import_error(self, tmp_path, monkeypatch):
        """When kokoro_onnx package is not installed, _import_kokoro raises."""
        import sys
        monkeypatch.setitem(sys.modules, "kokoro_onnx", None)
        from tools.tts_tool import _generate_kokoro_tts

        with pytest.raises((ImportError, TypeError)):
            _generate_kokoro_tts("Hi", str(tmp_path / "out.wav"), {})


class TestResolveKokoroAssets:
    def test_uses_explicit_model_and_voices_path(self, tmp_path):
        from tools.tts_tool import _resolve_kokoro_assets

        model_file = tmp_path / "my-model.onnx"
        voices_file = tmp_path / "my-voices.bin"
        model_file.write_bytes(b"fake-model")
        voices_file.write_bytes(b"fake-voices")

        model_path, voices_path = _resolve_kokoro_assets(
            {"model_path": str(model_file), "voices_path": str(voices_file)}
        )

        assert model_path == str(model_file)
        assert voices_path == str(voices_file)

    def test_downloads_missing_assets(self, tmp_path, monkeypatch):
        from tools import tts_tool as _tt

        downloaded = []

        def fake_download(filename, dest):
            downloaded.append(filename)
            dest.write_bytes(b"fake-bytes")

        monkeypatch.setattr(_tt, "_download_kokoro_asset", fake_download)

        model_path, voices_path = _tt._resolve_kokoro_assets({"models_dir": str(tmp_path)})

        assert downloaded == [_tt.DEFAULT_KOKORO_MODEL_FILE, _tt.DEFAULT_KOKORO_VOICES_FILE]
        assert model_path == str(tmp_path / _tt.DEFAULT_KOKORO_MODEL_FILE)
        assert voices_path == str(tmp_path / _tt.DEFAULT_KOKORO_VOICES_FILE)

    def test_skips_download_when_already_cached(self, tmp_path, monkeypatch):
        from tools import tts_tool as _tt

        (tmp_path / _tt.DEFAULT_KOKORO_MODEL_FILE).write_bytes(b"cached-model")
        (tmp_path / _tt.DEFAULT_KOKORO_VOICES_FILE).write_bytes(b"cached-voices")

        def fail_download(*args, **kwargs):
            raise AssertionError("should not download when files already exist")

        monkeypatch.setattr(_tt, "_download_kokoro_asset", fail_download)

        model_path, voices_path = _tt._resolve_kokoro_assets({"models_dir": str(tmp_path)})

        assert model_path == str(tmp_path / _tt.DEFAULT_KOKORO_MODEL_FILE)
        assert voices_path == str(tmp_path / _tt.DEFAULT_KOKORO_VOICES_FILE)


class TestCheckKokoroAvailable:
    def test_reports_available_when_package_present(self, monkeypatch):
        import importlib.util
        from tools.tts_tool import _check_kokoro_available

        fake_spec = MagicMock()
        monkeypatch.setattr(
            importlib.util, "find_spec",
            lambda name: fake_spec if name == "kokoro_onnx" else None,
        )
        assert _check_kokoro_available() is True

    def test_reports_unavailable_when_package_missing(self, monkeypatch):
        import importlib.util
        from tools.tts_tool import _check_kokoro_available

        monkeypatch.setattr(importlib.util, "find_spec", lambda name: None)
        assert _check_kokoro_available() is False


class TestDispatcherBranch:
    def test_kokoro_not_installed_returns_helpful_error(self, monkeypatch, tmp_path):
        """When provider=kokoro but package missing, return JSON error with setup hint."""
        import sys
        monkeypatch.setitem(sys.modules, "kokoro_onnx", None)
        monkeypatch.setenv("JARVIS_HOME", str(tmp_path))

        from tools.tts_tool import text_to_speech_tool

        import yaml
        (tmp_path / "config.yaml").write_text(
            yaml.safe_dump({"tts": {"provider": "kokoro"}})
        )

        result = json.loads(text_to_speech_tool(text="Hello"))
        assert result["success"] is False
        assert "kokoro" in result["error"].lower()
        assert "pip install kokoro-onnx" in result["error"].lower()

    def test_kokoro_dispatch_generates_audio(self, monkeypatch, tmp_path, mock_kokoro_module):
        """When provider=kokoro and the package is available, synthesis runs end to end."""
        from tools import tts_tool as _tt

        monkeypatch.setenv("JARVIS_HOME", str(tmp_path))
        # sys.modules patching alone doesn't fool importlib.util.find_spec
        # (see _check_kokoro_available) - the dispatch elif's own
        # availability gate is exercised separately by
        # TestCheckKokoroAvailable, so stub it directly here.
        monkeypatch.setattr(_tt, "_check_kokoro_available", lambda: True)

        from tools.tts_tool import text_to_speech_tool

        import yaml
        (tmp_path / "config.yaml").write_text(
            yaml.safe_dump({"tts": {"provider": "kokoro"}})
        )

        result = json.loads(text_to_speech_tool(text="Hello"))
        assert result["success"] is True
        assert result["provider"] == "kokoro"
        assert result["file_path"]


class TestCheckTtsRequirementsKokoro:
    def test_kokoro_install_satisfies_requirements(self, monkeypatch):
        from tools import tts_tool as _tt

        monkeypatch.setattr(_tt, "_import_edge_tts", lambda: (_ for _ in ()).throw(ImportError()))
        monkeypatch.setattr(_tt, "_import_elevenlabs", lambda: (_ for _ in ()).throw(ImportError()))
        monkeypatch.setattr(_tt, "_import_openai_client", lambda: (_ for _ in ()).throw(ImportError()))
        monkeypatch.setattr(_tt, "_import_mistral_client", lambda: (_ for _ in ()).throw(ImportError()))
        monkeypatch.setattr(_tt, "_check_neutts_available", lambda: False)
        monkeypatch.setattr(_tt, "_check_kittentts_available", lambda: False)
        monkeypatch.setattr(_tt, "_check_piper_available", lambda: False)
        monkeypatch.setattr(_tt, "_has_any_command_tts_provider", lambda: False)
        monkeypatch.setattr(_tt, "_has_openai_audio_backend", lambda: False)
        for env in ("MINIMAX_API_KEY", "XAI_API_KEY", "GEMINI_API_KEY",
                    "GOOGLE_API_KEY", "MISTRAL_API_KEY", "ELEVENLABS_API_KEY"):
            monkeypatch.delenv(env, raising=False)

        monkeypatch.setattr(_tt, "_check_kokoro_available", lambda: False)
        assert _tt.check_tts_requirements() is False

        monkeypatch.setattr(_tt, "_check_kokoro_available", lambda: True)
        assert _tt.check_tts_requirements() is True
