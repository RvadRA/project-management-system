"""Compare base and small using one local WAV file and sequential model loads."""
import time
import wave
from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.test import override_settings

from assistant import router


class Command(BaseCommand):
    help = 'Сравнить локальные модели распознавания на одном WAV-файле последовательно.'

    def add_arguments(self, parser):
        parser.add_argument('audio_file', type=Path, help='Путь к WAV-файлу с тестовой речью.')
        parser.add_argument(
            '--language',
            choices=('auto', 'ru', 'en', 'uz'),
            default='ru',
            help='Язык записи; по умолчанию русский.',
        )
        parser.add_argument(
            '--models',
            nargs='+',
            choices=('base', 'small'),
            default=('base', 'small'),
            help='Модели для последовательного сравнения; по умолчанию base small.',
        )

    def handle(self, *args, **options):
        if args:
            raise CommandError(f'Неожиданные аргументы: {" ".join(args)}')
        audio_path = options['audio_file'].expanduser()
        if not audio_path.is_file():
            raise CommandError(f'Аудиофайл не найден: {audio_path}')
        if audio_path.stat().st_size > settings.MAX_AUDIO_MB * 1024 * 1024:
            raise CommandError(f'Файл превышает лимит {settings.MAX_AUDIO_MB} МБ.')

        try:
            with wave.open(str(audio_path), 'rb') as audio_file:
                if (
                    audio_file.getnchannels() != 1
                    or audio_file.getframerate() != 16000
                    or audio_file.getsampwidth() != 2
                    or audio_file.getcomptype() != 'NONE'
                ):
                    raise CommandError('Нужен несжатый WAV: 16 кГц, моно, 16 бит.')
                if audio_file.getnframes() > 60 * audio_file.getframerate():
                    raise CommandError('Длительность записи не должна превышать 60 секунд.')
        except (OSError, wave.Error) as exc:
            raise CommandError(f'Не удалось прочитать WAV-файл: {exc}') from exc

        wav_bytes = audio_path.read_bytes()
        models = tuple(dict.fromkeys(options['models']))
        for model_name in models:
            started = time.perf_counter()
            try:
                with override_settings(STT_MODEL=model_name):
                    text, provider = router.transcribe(wav_bytes, language=options['language'])
            except router.AllProvidersFailed as exc:
                reasons = '; '.join(f'{name}: {reason}' for name, reason in exc.attempts)
                raise CommandError(f'Модель «{model_name}» не выполнила распознавание: {reasons}') from exc

            elapsed = time.perf_counter() - started
            self.stdout.write(
                self.style.MIGRATE_HEADING(
                    f'Провайдер: {provider} · модель: {model_name} · {elapsed:.2f} с'
                )
            )
            self.stdout.write(text or '(речь не распознана)')
