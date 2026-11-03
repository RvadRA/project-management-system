import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

import app
from config import Settings
from transcription import InferenceBusyError, TranscriptionError


class TranscriptionEndpointTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        root = Path(self.directory.name)
        self.settings = Settings(
            model="base",
            cpu_threads=2,
            beam_size=1,
            max_audio_mb=1,
            port=8765,
            model_cache=root / "models",
            temp_dir=root / "temp",
        )
        self.patches = (
            patch.object(app, "settings", self.settings),
            patch.object(app, "MAX_AUDIO_BYTES", 3),
        )
        for patcher in self.patches:
            patcher.start()
        self.client = TestClient(app.app)

    def tearDown(self):
        self.client.close()
        for patcher in reversed(self.patches):
            patcher.stop()
        self.directory.cleanup()

    def temporary_audio_files(self):
        if not self.settings.temp_dir.exists():
            return []
        return list(self.settings.temp_dir.iterdir())

    def test_config_describes_model_and_upload_limit(self):
        response = self.client.get("/api/config")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["model"], "base")
        self.assertEqual(response.json()["max_audio_mb"], 1)
        self.assertEqual(set(response.json()["languages"]), {"auto", "en", "ru", "uz"})

    def test_audio_is_transcribed_and_temporary_copy_is_removed(self):
        expected = {
            "text": "recognized text",
            "language": "en",
            "language_probability": 0.99,
            "audio_seconds": 1.0,
            "processing_seconds": 0.2,
        }
        with patch("app.transcribe_file", return_value=expected) as transcribe:
            response = self.client.post(
                "/api/transcribe",
                files={"file": ("sample.wav", b"wav", "audio/wav")},
                data={"language": "en"},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), expected)
        transcribe.assert_called_once()
        self.assertEqual(transcribe.call_args.args[1], "en")
        self.assertEqual(self.temporary_audio_files(), [])

    def test_empty_audio_is_rejected_and_temporary_copy_is_removed(self):
        response = self.client.post(
            "/api/transcribe",
            files={"file": ("empty.wav", b"", "audio/wav")},
            data={"language": "auto"},
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("empty", response.json()["detail"])
        self.assertEqual(self.temporary_audio_files(), [])

    def test_oversized_audio_is_rejected_and_temporary_copy_is_removed(self):
        response = self.client.post(
            "/api/transcribe",
            files={"file": ("large.wav", b"1234", "audio/wav")},
            data={"language": "auto"},
        )

        self.assertEqual(response.status_code, 413)
        self.assertIn("exceeds", response.json()["detail"])
        self.assertEqual(self.temporary_audio_files(), [])

    def test_unsupported_format_is_rejected(self):
        response = self.client.post(
            "/api/transcribe",
            files={"file": ("document.txt", b"not audio", "text/plain")},
            data={"language": "auto"},
        )

        self.assertEqual(response.status_code, 415)

    def test_invalid_language_is_rejected_before_audio_is_staged(self):
        response = self.client.post(
            "/api/transcribe",
            files={"file": ("sample.wav", b"wav", "audio/wav")},
            data={"language": "fr"},
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(self.temporary_audio_files(), [])

    def test_busy_and_transcription_errors_are_reported(self):
        with patch("app.transcribe_file", side_effect=InferenceBusyError("Already working.")):
            busy = self.client.post(
                "/api/transcribe",
                files={"file": ("sample.wav", b"wav", "audio/wav")},
                data={"language": "auto"},
            )
        self.assertEqual(busy.status_code, 409)

        with patch("app.transcribe_file", side_effect=TranscriptionError("Invalid audio.")):
            failure = self.client.post(
                "/api/transcribe",
                files={"file": ("sample.wav", b"wav", "audio/wav")},
                data={"language": "auto"},
            )
        self.assertEqual(failure.status_code, 422)
        self.assertIn("Invalid audio", failure.json()["detail"])
        self.assertEqual(self.temporary_audio_files(), [])


if __name__ == "__main__":
    unittest.main()
