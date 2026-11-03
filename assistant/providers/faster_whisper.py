"""Local CPU speech recognition for the assistant."""
import gc
import importlib.util
import logging
import sys
import threading
from io import BytesIO
from importlib.metadata import PackageNotFoundError, version

from django.conf import settings

from .base import Provider, ProviderError

logger = logging.getLogger('ai')
_INFERENCE_LOCK = threading.Lock()
SUPPORTED_LANGUAGES = frozenset(('auto', 'en', 'ru', 'uz'))


class FasterWhisperProvider(Provider):
    name = 'faster-whisper'

    @property
    def title(self):
        return f'Локальное распознавание · {settings.STT_MODEL}'

    def _availability_error(self):
        if not settings.STT_ENABLED:
            return 'включите STT_ENABLED'
        if not settings.STT_MODEL:
            return 'задайте STT_MODEL'
        if not importlib.util.find_spec('faster_whisper'):
            return 'установите зависимости из requirements.txt'
        try:
            av_version = version('av')
        except PackageNotFoundError:
            return 'установите PyAV из requirements.txt в окружении сервера'
        loaded_av = sys.modules.get('av')
        loaded_av_version = getattr(loaded_av, '__version__', None)
        if loaded_av_version and loaded_av_version != av_version:
            return (
                f'в сервере уже загружен PyAV {loaded_av_version}, а в окружении установлен {av_version}; '
                'перезапустите сервер'
            )
        try:
            av_major = int(av_version.split('.', maxsplit=1)[0])
        except ValueError:
            return f'не удалось проверить совместимость установленного PyAV {av_version}'
        if av_major >= 19:
            return (
                f'PyAV {av_version} несовместим с faster-whisper 1.1.1; '
                'установите зависимости из requirements.txt и перезапустите сервер (требуется PyAV <19)'
            )
        return ''

    def can_transcribe(self):
        return not self._availability_error()

    def setup_hint(self):
        return self._availability_error() or 'модель загрузится при первом распознавании'

    def probe(self):
        error = self._availability_error()
        return {'available': not error, 'error': error}

    def _inference_error(self, exc):
        if type(exc).__module__.startswith('huggingface_hub.'):
            return (
                f'не удалось загрузить модель «{settings.STT_MODEL}»; '
                'при первой загрузке проверьте подключение к интернету и имя STT_MODEL'
            )
        detail = str(exc).lower()
        if isinstance(exc, FileNotFoundError) or any(
            marker in detail
            for marker in ('model.bin', 'no such file', 'file not found', 'does not exist')
        ):
            return (
                f'файлы модели «{settings.STT_MODEL}» не найдены или повреждены; '
                'проверьте STT_MODEL и каталог STT_MODEL_CACHE_DIR'
            )
        return 'не удалось распознать запись; проверьте аудио и попробуйте ещё раз'

    def transcribe(self, wav_bytes, language='ru'):
        if language not in SUPPORTED_LANGUAGES:
            raise ProviderError('bad_request', 'выберите русский, английский, узбекский или автоопределение')
        if not self.can_transcribe():
            raise ProviderError('unavailable', self.setup_hint())
        if not _INFERENCE_LOCK.acquire(blocking=False):
            raise ProviderError('unavailable', 'другая запись уже распознаётся')

        model = None
        try:
            try:
                from faster_whisper import WhisperModel
            except ImportError as exc:
                raise ProviderError(
                    'unavailable',
                    'установите faster-whisper и его зависимости в окружении сервера',
                ) from exc

            settings.STT_MODEL_CACHE_DIR.mkdir(parents=True, exist_ok=True)
            model = WhisperModel(
                settings.STT_MODEL,
                device='cpu',
                compute_type='int8',
                cpu_threads=settings.STT_CPU_THREADS,
                num_workers=1,
                download_root=str(settings.STT_MODEL_CACHE_DIR),
            )
            segments = model.transcribe(
                BytesIO(wav_bytes),
                language=None if language == 'auto' else language,
                beam_size=settings.STT_BEAM_SIZE,
                vad_filter=True,
            )[0]
            return ' '.join(
                segment.text.strip()
                for segment in segments
                if segment.text and segment.text.strip()
            )
        except (OSError, RuntimeError, ValueError) as exc:
            logger.warning('Local speech recognition failed: %s', type(exc).__name__)
            raise ProviderError('unavailable', self._inference_error(exc)) from exc
        except TypeError as exc:
            if 'metadata_errors' not in str(exc):
                raise
            logger.exception('Incompatible PyAV API while decoding audio')
            raise ProviderError(
                'unavailable',
                'установлена несовместимая версия PyAV; установите зависимости из requirements.txt и перезапустите сервер',
            ) from exc
        finally:
            if model is not None:
                del model
                gc.collect()
            _INFERENCE_LOCK.release()
