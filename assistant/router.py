"""
Provider routing for the AI assistant.

Ollama handles chat and task analysis; local faster-whisper handles speech
transcription. Neither path falls back to an external service.
"""
import logging

from django.core.cache import cache

from .providers.base import ProviderError
from .providers.faster_whisper import FasterWhisperProvider
from .providers.ollama import OllamaProvider

log = logging.getLogger('ai')

REASONS = {
    'quota': 'исчерпан лимит',
    'auth': 'ключ не принят',
    'unavailable': 'сервис недоступен',
    'bad_request': 'запрос отклонён',
    'model': 'модель недоступна',
    'unsupported': 'не поддерживается',
}

HEALTH_CACHE_KEY = 'ai:ollama:health'
STT_HEALTH_CACHE_KEY = 'ai:faster-whisper:health'


class AllProvidersFailed(Exception):
    """Ни один провайдер не смог выполнить запрос."""

    def __init__(self, attempts, diagnostics=()):
        super().__init__('all providers failed')
        self.attempts = attempts   # [(имя, причина)]
        self.diagnostics = diagnostics  # [(имя, безопасный код ошибки)]


def providers():
    """The local Ollama model handles chat and task analysis."""
    return [OllamaProvider()]


def all_providers():
    """Return the local providers for chat and speech recognition."""
    return [*providers(), FasterWhisperProvider()]


def _providers_for(operation):
    return providers() if operation == 'chat' else [FasterWhisperProvider()]


def _health(provider):
    """Short-lived probe so the status endpoint does not wait on every poll."""
    cache_key = STT_HEALTH_CACHE_KEY if provider.name == 'faster-whisper' else HEALTH_CACHE_KEY
    cached = cache.get(cache_key)
    if cached is not None:
        return cached
    health = provider.probe()
    cache.set(cache_key, health, 5)
    return health


def run(operation, call, only=None):
    """
    Выполняет call(provider) у первого доступного провайдера.
    operation — 'chat' или 'transcribe'. Возвращает (результат, имя провайдера).
    only — явный список провайдеров (используется для тестов/диагностики).
    """
    attempts = []
    diagnostics = []
    provider_list = list(only) if only is not None else _providers_for(operation)
    if not provider_list:
        raise AllProvidersFailed(
            [('ollama', 'локальная модель не настроена')],
            [('ollama', 'provider_not_configured')],
        )
    for provider in provider_list:
        capable = provider.can_chat() if operation == 'chat' else provider.can_transcribe()
        if not capable:
            attempts.append((provider.name, provider.setup_hint() or 'не настроен'))
            diagnostics.append((provider.name, 'provider_not_configured'))
            continue
        try:
            result = call(provider)
        except ProviderError as error:
            reason = str(error) if operation == 'transcribe' else REASONS.get(error.kind, error.kind)
            attempts.append((provider.name, reason))
            diagnostics.append((provider.name, error.code))
            log.warning('provider=%s op=%s failed kind=%s code=%s',
                        provider.name, operation, error.kind, error.code)
            continue
        log.info('provider=%s op=%s ok', provider.name, operation)
        return result, provider.name
    raise AllProvidersFailed(attempts, diagnostics)


def chat(messages, **options):
    return run('chat', lambda p: p.chat(messages, **options))


def local_chat(messages, **options):
    """Backward-compatible name: the local model is now the only provider."""
    return chat(messages, **options)


def transcribe(wav_bytes, language='ru'):
    """Recognize speech locally without sending audio to Ollama or a cloud API."""
    return run('transcribe', lambda provider: provider.transcribe(wav_bytes, language=language))


def status():
    """Состояние локального провайдера. Ключи и их части не возвращаются."""
    rows = []
    for provider in all_providers():
        health = _health(provider)
        rows.append({
            'name': provider.name,
            'title': provider.title,
            'chat': provider.can_chat(),
            'transcribe': provider.can_transcribe(),
            'hint': provider.setup_hint(),
            'available': health['available'],
            'model_installed': health.get('model_installed'),
            'error': health.get('error', ''),
            'paused': {},
        })
    return rows


def reset_pauses():
    """Clear cached local model health so the next status call re-probes."""
    cache.delete(HEALTH_CACHE_KEY)
    cache.delete(STT_HEALTH_CACHE_KEY)
