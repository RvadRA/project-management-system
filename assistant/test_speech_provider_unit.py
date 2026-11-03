"""Database-free unit tests for the local speech-recognition provider."""
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest import mock

from django.test import override_settings

from assistant.providers import faster_whisper as provider_module
from assistant.providers.base import ProviderError


class Segment:
    def __init__(self, text):
        self.text = text


class FakeWhisperModel:
    instances = []

    def __init__(self, *args, **kwargs):
        self.args = args
        self.kwargs = kwargs
        self.received_audio = None
        self.transcribe_options = None
        self.instances.append(self)

    def transcribe(self, audio, **kwargs):
        self.received_audio = audio.read()
        self.transcribe_options = kwargs
        return iter((Segment(' Распознанный'), Segment(' текст. '))), object()


class FailedWhisperModel(FakeWhisperModel):
    def transcribe(self, audio, **kwargs):
        raise RuntimeError('model inference failed')


class MissingModelWhisperModel(FakeWhisperModel):
    def __init__(self, *args, **kwargs):
        raise FileNotFoundError('model.bin')


class SpeechProviderTests(unittest.TestCase):
    def setUp(self):
        FakeWhisperModel.instances = []
        FailedWhisperModel.instances = []
        self.temp_dir = tempfile.TemporaryDirectory()
        self.cache_dir = Path(self.temp_dir.name) / 'models'
        self.settings = override_settings(
            STT_ENABLED=True,
            STT_MODEL='base',
            STT_CPU_THREADS=2,
            STT_BEAM_SIZE=1,
            STT_MODEL_CACHE_DIR=self.cache_dir,
        )
        self.settings.enable()
        self.provider = provider_module.FasterWhisperProvider()
        self.av_version = mock.patch.object(provider_module, 'version', return_value='18.1.0')
        self.av_version.start()

    def tearDown(self):
        self.av_version.stop()
        self.settings.disable()
        self.temp_dir.cleanup()

    @staticmethod
    def fake_modules(model_class):
        whisper = types.ModuleType('faster_whisper')
        whisper.WhisperModel = model_class
        hub = types.ModuleType('huggingface_hub')
        hub.__path__ = []
        errors = types.ModuleType('huggingface_hub.errors')

        class HfHubHTTPError(OSError):
            pass

        errors.HfHubHTTPError = HfHubHTTPError
        return {
            'faster_whisper': whisper,
            'huggingface_hub': hub,
            'huggingface_hub.errors': errors,
        }, HfHubHTTPError

    def test_transcription_uses_local_cpu_int8_model_and_selected_language(self):
        modules, _ = self.fake_modules(FakeWhisperModel)
        with (
            mock.patch.dict(sys.modules, modules),
            mock.patch.object(provider_module.importlib.util, 'find_spec', return_value=object()),
        ):
            result = self.provider.transcribe(b'local wav bytes', language='uz')

        model = FakeWhisperModel.instances[0]
        self.assertEqual(result, 'Распознанный текст.')
        self.assertEqual(model.kwargs['device'], 'cpu')
        self.assertEqual(model.kwargs['compute_type'], 'int8')
        self.assertEqual(model.kwargs['cpu_threads'], 2)
        self.assertEqual(model.kwargs['num_workers'], 1)
        self.assertEqual(model.kwargs['download_root'], str(self.cache_dir))
        self.assertEqual(model.received_audio, b'local wav bytes')
        self.assertEqual(
            model.transcribe_options,
            {'language': 'uz', 'beam_size': 1, 'vad_filter': True},
        )

    def test_configured_small_model_and_beam_size_are_passed_to_inference(self):
        modules, _ = self.fake_modules(FakeWhisperModel)
        with (
            override_settings(STT_MODEL='small', STT_BEAM_SIZE=2),
            mock.patch.dict(sys.modules, modules),
            mock.patch.object(provider_module.importlib.util, 'find_spec', return_value=object()),
        ):
            self.provider.transcribe(b'local wav bytes', language='ru')

        model = FakeWhisperModel.instances[0]
        self.assertEqual(model.args[0], 'small')
        self.assertEqual(model.transcribe_options['beam_size'], 2)

    def test_auto_language_is_sent_to_model_as_none(self):
        modules, _ = self.fake_modules(FakeWhisperModel)
        with (
            mock.patch.dict(sys.modules, modules),
            mock.patch.object(provider_module.importlib.util, 'find_spec', return_value=object()),
        ):
            self.provider.transcribe(b'local wav bytes', language='auto')

        self.assertIsNone(FakeWhisperModel.instances[0].transcribe_options['language'])

    def test_invalid_language_is_rejected_before_model_load(self):
        with self.assertRaises(ProviderError):
            self.provider.transcribe(b'local wav bytes', language='fr')

        self.assertEqual(FakeWhisperModel.instances, [])

    def test_pyav_19_is_reported_as_incompatible_and_blocks_transcription(self):
        with mock.patch.object(provider_module, 'version', return_value='19.0.2'):
            status = self.provider.probe()
            self.assertFalse(status['available'])
            self.assertIn('PyAV 19.0.2 несовместим', status['error'])
            with self.assertRaisesRegex(ProviderError, 'PyAV 19.0.2 несовместим'):
                self.provider.transcribe(b'local wav bytes')

        self.assertEqual(FakeWhisperModel.instances, [])

    def test_loaded_pyav_version_different_from_installed_version_requires_restart(self):
        loaded_av = types.SimpleNamespace(__version__='19.0.2')
        with (
            mock.patch.object(provider_module, 'version', return_value='18.1.0'),
            mock.patch.dict(sys.modules, {'av': loaded_av}),
        ):
            status = self.provider.probe()

        self.assertFalse(status['available'])
        self.assertIn('в сервере уже загружен PyAV 19.0.2', status['error'])
        self.assertIn('перезапустите сервер', status['error'])

    def test_model_errors_are_reported_and_lock_is_released(self):
        modules, _ = self.fake_modules(FailedWhisperModel)
        with (
            mock.patch.dict(sys.modules, modules),
            mock.patch.object(provider_module.importlib.util, 'find_spec', return_value=object()),
        ):
            with self.assertRaises(ProviderError):
                self.provider.transcribe(b'local wav bytes')

        modules, _ = self.fake_modules(FakeWhisperModel)
        with (
            mock.patch.dict(sys.modules, modules),
            mock.patch.object(provider_module.importlib.util, 'find_spec', return_value=object()),
        ):
            self.assertEqual(self.provider.transcribe(b'local wav bytes'), 'Распознанный текст.')

    def test_missing_model_file_has_a_specific_actionable_error(self):
        modules, _ = self.fake_modules(MissingModelWhisperModel)
        with (
            mock.patch.dict(sys.modules, modules),
            mock.patch.object(provider_module.importlib.util, 'find_spec', return_value=object()),
        ):
            with self.assertRaises(ProviderError) as raised:
                self.provider.transcribe(b'local wav bytes')

        self.assertIn('файлы модели «base» не найдены или повреждены', str(raised.exception))
        self.assertIn('STT_MODEL_CACHE_DIR', str(raised.exception))

    def test_second_inference_is_rejected_while_model_is_busy(self):
        self.assertTrue(provider_module._INFERENCE_LOCK.acquire(blocking=False))
        try:
            with self.assertRaises(ProviderError) as raised:
                self.provider.transcribe(b'local wav bytes')
            self.assertEqual(raised.exception.kind, 'unavailable')
        finally:
            provider_module._INFERENCE_LOCK.release()


if __name__ == '__main__':
    unittest.main()
