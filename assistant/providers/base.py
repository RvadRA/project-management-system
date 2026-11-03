"""Общий интерфейс провайдеров нейросетей."""
import requests
from django.conf import settings


class ProviderError(Exception):
    """
    Отказ провайдера. kind определяет, что делать дальше:
      quota       — исчерпан лимит или слишком частые запросы → переключиться и подождать;
      auth        — ключ не принят → переключиться надолго;
      unavailable — сервис не отвечает → переключиться ненадолго;
      unsupported — провайдер не умеет этого (например, такой формат звука) → просто следующий;
      bad_request — запрос отклонён по содержанию → следующий без паузы.
    """

    def __init__(self, kind, message='', retry_after=None, code=None):
        super().__init__(message or kind)
        self.kind = kind
        self.retry_after = retry_after
        self.code = code or kind


class Provider:
    name = ''
    title = ''

    # ── что настроено ────────────────────────────────────────────────────────
    def can_chat(self) -> bool:
        return False

    def can_transcribe(self) -> bool:
        return False

    def setup_hint(self) -> str:
        """Чего не хватает в настройках (пустая строка — всё задано)."""
        return ''

    # ── операции ─────────────────────────────────────────────────────────────
    def chat(
        self,
        messages,
        temperature=0.2,
        max_tokens=900,
        json_mode=False,
        think=False,
        format_schema=None,
    ) -> str:
        raise ProviderError('unsupported')

    def transcribe(self, wav_bytes: bytes, language='ru') -> str:
        raise ProviderError('unsupported')

    # ── общее ────────────────────────────────────────────────────────────────
    def _post(self, url, **kwargs):
        try:
            response = requests.post(url, timeout=settings.AI_REQUEST_TIMEOUT, **kwargs)
        except requests.Timeout:
            raise ProviderError('unavailable', 'таймаут')
        except requests.RequestException as exc:
            raise ProviderError('unavailable', type(exc).__name__)
        if response.status_code < 300:
            return response
        raise self._error_from(response)

    def _error_from(self, response) -> ProviderError:
        code = response.status_code
        try:
            retry_after = float(response.headers.get('Retry-After', ''))
        except (TypeError, ValueError):
            retry_after = None
        # Текст ошибки провайдера в ответ пользователю не попадает — только в журнал, и без ключей
        detail = f'HTTP {code}'
        if code in (401, 403):
            return ProviderError('auth', detail)
        if code in (402, 429):
            return ProviderError('quota', detail, retry_after)
        if code >= 500:
            return ProviderError('unavailable', detail, retry_after)
        return ProviderError('bad_request', detail)
