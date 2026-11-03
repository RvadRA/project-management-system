"""Database-free tests for sequential STT model comparison."""
import io
import tempfile
import unittest
import wave
from pathlib import Path
from unittest import mock

from django.core.management import call_command
from django.core.management.base import CommandError

from assistant import router
from assistant.providers.base import ProviderError
from assistant.providers.faster_whisper import FasterWhisperProvider
from assistant.views import _failure_response


def create_wav(path):
    with wave.open(str(path), 'wb') as audio:
        audio.setnchannels(1)
        audio.setsampwidth(2)
        audio.setframerate(16000)
        audio.writeframes(b'\x00\x00' * 1600)


class CompareSpeechModelsCommandTests(unittest.TestCase):
    def test_compares_models_sequentially_using_same_recording_and_language(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            audio_path = Path(temp_dir) / 'phrase.wav'
            create_wav(audio_path)
            output = io.StringIO()
            observed = []

            def transcribe(_audio, language):
                from django.conf import settings

                observed.append((settings.STT_MODEL, language))
                return f'text from {settings.STT_MODEL}', 'faster-whisper'

            with mock.patch.object(router, 'transcribe', side_effect=transcribe):
                call_command(
                    'compare_speech_models',
                    str(audio_path),
                    language='ru',
                    stdout=output,
                )

        self.assertEqual(observed, [('base', 'ru'), ('small', 'ru')])
        self.assertIn('base', output.getvalue())
        self.assertIn('small', output.getvalue())

    def test_rejects_missing_audio_without_running_inference(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            missing_path = Path(temp_dir) / 'missing.wav'
            with mock.patch.object(router, 'transcribe') as transcribe:
                with self.assertRaises(CommandError):
                    call_command('compare_speech_models', str(missing_path), stdout=io.StringIO())

        transcribe.assert_not_called()

    def test_transcription_failure_detail_is_returned_to_the_client(self):
        with (
            mock.patch.object(FasterWhisperProvider, 'can_transcribe', return_value=True),
            mock.patch.object(
                FasterWhisperProvider,
                'transcribe',
                side_effect=ProviderError('unavailable', 'файлы модели не найдены'),
            ),
        ):
            with self.assertRaises(router.AllProvidersFailed) as raised:
                router.transcribe(b'audio')

        response = _failure_response(raised.exception)
        self.assertEqual(response.status_code, 503)
        self.assertIn('файлы модели не найдены', response.data['error'])


if __name__ == '__main__':
    unittest.main()
