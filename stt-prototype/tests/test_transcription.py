import os
import sys
import types
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from config import Settings
from transcription import (
    InferenceBusyError,
    TranscriptionError,
    transcribe_file,
)


class SettingsTests(unittest.TestCase):
    def test_defaults_are_cpu_friendly_and_model_cache_is_outside_project(self):
        defaults = {
            "STT_MODEL": "base",
            "STT_CPU_THREADS": "2",
            "STT_BEAM_SIZE": "1",
            "STT_MAX_AUDIO_MB": "25",
            "STT_PORT": "8765",
        }
        with patch.dict(os.environ, defaults):
            settings = Settings.from_env()

        self.assertEqual(settings.model, "base")
        self.assertEqual(settings.cpu_threads, 2)
        self.assertEqual(settings.beam_size, 1)
        self.assertEqual(settings.max_audio_mb, 25)
        self.assertNotIn("stt-prototype", str(settings.model_cache))

    def test_environment_values_are_loaded_and_validated(self):
        values = {
            "STT_MODEL": "small",
            "STT_CPU_THREADS": "3",
            "STT_BEAM_SIZE": "2",
            "STT_MAX_AUDIO_MB": "12",
            "STT_PORT": "9876",
        }
        with patch.dict(os.environ, values):
            settings = Settings.from_env()

        self.assertEqual(settings.model, "small")
        self.assertEqual(settings.cpu_threads, 3)
        self.assertEqual(settings.beam_size, 2)
        self.assertEqual(settings.max_audio_mb, 12)
        self.assertEqual(settings.port, 9876)

    def test_nonpositive_integer_setting_is_rejected(self):
        with patch.dict(os.environ, {"STT_CPU_THREADS": "0"}):
            with self.assertRaisesRegex(ValueError, "STT_CPU_THREADS"):
                Settings.from_env()


class FakeSegment:
    def __init__(self, text):
        self.text = text


class FakeInfo:
    language = "ru"
    language_probability = 0.98765
    duration = 4.25


class FakeWhisperModel:
    instances = []

    def __init__(self, *args, **kwargs):
        self.args = args
        self.kwargs = kwargs
        self.calls = []
        self.instances.append(self)

    def transcribe(self, path, **kwargs):
        self.calls.append((path, kwargs))
        return iter((FakeSegment("  Проверка"), FakeSegment(" локальной речи. "))), FakeInfo()


class TranscriptionTests(unittest.TestCase):
    def setUp(self):
        FakeWhisperModel.instances = []
        self.temp_dir = TemporaryDirectory()
        root = Path(self.temp_dir.name)
        self.audio_path = root / "sample.wav"
        self.audio_path.write_bytes(b"test audio placeholder")
        self.settings = Settings(
            model="base",
            cpu_threads=2,
            beam_size=1,
            max_audio_mb=25,
            port=8765,
            model_cache=root / "models",
            temp_dir=root / "temp",
        )
        fake_module = types.ModuleType("faster_whisper")
        fake_module.WhisperModel = FakeWhisperModel
        self.module_patch = patch.dict(sys.modules, {"faster_whisper": fake_module})
        self.module_patch.start()

    def tearDown(self):
        self.module_patch.stop()
        self.temp_dir.cleanup()

    def test_model_is_cpu_int8_and_language_is_passed_to_inference(self):
        result = transcribe_file(self.audio_path, "ru", self.settings)

        model = FakeWhisperModel.instances[0]
        self.assertEqual(model.args, ("base",))
        self.assertEqual(model.kwargs["device"], "cpu")
        self.assertEqual(model.kwargs["compute_type"], "int8")
        self.assertEqual(model.kwargs["cpu_threads"], 2)
        self.assertEqual(model.kwargs["num_workers"], 1)
        self.assertEqual(model.kwargs["download_root"], str(self.settings.model_cache))
        self.assertEqual(model.calls[0][1], {"language": "ru", "beam_size": 1, "vad_filter": True})
        self.assertEqual(result["text"], "Проверка локальной речи.")
        self.assertEqual(result["language"], "ru")
        self.assertEqual(result["language_probability"], 0.9877)
        self.assertEqual(result["audio_seconds"], 4.25)

    def test_auto_language_is_passed_as_automatic_detection(self):
        transcribe_file(self.audio_path, "auto", self.settings)

        self.assertIsNone(FakeWhisperModel.instances[0].calls[0][1]["language"])

    def test_invalid_language_does_not_load_model(self):
        with self.assertRaises(ValueError):
            transcribe_file(self.audio_path, "fr", self.settings)

        self.assertEqual(FakeWhisperModel.instances, [])

    def test_a_concurrent_request_is_rejected(self):
        from transcription import _INFERENCE_LOCK

        _INFERENCE_LOCK.acquire()
        try:
            with self.assertRaises(InferenceBusyError):
                transcribe_file(self.audio_path, "auto", self.settings)
        finally:
            _INFERENCE_LOCK.release()

    def test_model_error_is_reported_and_lock_can_be_reused(self):
        class FailingModel(FakeWhisperModel):
            def transcribe(self, path, **kwargs):
                raise RuntimeError("invalid audio")

        fake_module = types.ModuleType("faster_whisper")
        fake_module.WhisperModel = FailingModel
        with patch.dict(sys.modules, {"faster_whisper": fake_module}):
            with self.assertRaisesRegex(TranscriptionError, "invalid audio"):
                transcribe_file(self.audio_path, "auto", self.settings)

        result = transcribe_file(self.audio_path, "auto", self.settings)
        self.assertEqual(result["language"], "ru")


if __name__ == "__main__":
    unittest.main()
