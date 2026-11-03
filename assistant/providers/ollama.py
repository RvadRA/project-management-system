"""Local Ollama chat provider. This is the only AI assistant provider."""
import logging
import time

import requests
from django.conf import settings

from .base import Provider, ProviderError

log = logging.getLogger('ai')


class OllamaProvider(Provider):
    """One local model from the existing OLLAMA_* configuration."""

    def __init__(self):
        self.model = settings.OLLAMA_CHAT_MODEL
        self.name = f'ollama:{self.model}'
        self.title = f'Ollama · {self.model}'

    def can_chat(self):
        return bool(settings.OLLAMA_BASE_URL and self.model)

    def setup_hint(self):
        return '' if self.can_chat() else 'проверьте OLLAMA_BASE_URL и OLLAMA_CHAT_MODEL'

    def probe(self):
        """Check that Ollama answers and the configured chat model is installed."""
        if not self.can_chat():
            return {
                'available': False,
                'model_installed': False,
                'error': 'локальная модель не настроена',
            }
        try:
            response = requests.get(
                f"{settings.OLLAMA_BASE_URL.rstrip('/')}/api/tags",
                timeout=settings.OLLAMA_STATUS_TIMEOUT,
            )
            response.raise_for_status()
            data = response.json()
        except requests.Timeout:
            return {
                'available': False,
                'model_installed': False,
                'error': 'Ollama не ответила за отведённое время',
            }
        except requests.RequestException as exc:
            return {
                'available': False,
                'model_installed': False,
                'error': f'Ollama недоступна: {type(exc).__name__}',
            }
        except ValueError:
            return {
                'available': False,
                'model_installed': False,
                'error': 'Ollama вернула некорректный ответ',
            }

        models = data.get('models') if isinstance(data, dict) else None
        names = {
            item.get('name') or item.get('model')
            for item in models or []
            if isinstance(item, dict)
        }
        installed = self.model in names or f'{self.model}:latest' in names
        if not installed:
            return {
                'available': False,
                'model_installed': False,
                'error': f'модель {self.model} не найдена в Ollama',
            }
        return {'available': True, 'model_installed': True, 'error': ''}

    def _error_from(self, response):
        code = response.status_code
        try:
            retry_after = float(response.headers.get('Retry-After', ''))
        except (TypeError, ValueError):
            retry_after = None
        try:
            detail = response.json().get('error', '')
        except (AttributeError, ValueError):
            detail = ''
        detail = str(detail) or f'HTTP {code}'
        if code == 404 or 'not found' in detail.lower():
            return ProviderError('model', detail, code='model_not_found')
        if code in (401, 403):
            return ProviderError('auth', detail, code='http_auth_error')
        if code in (400, 422):
            return ProviderError('bad_request', detail, code='http_bad_request')
        if code == 429 or code >= 500:
            return ProviderError('unavailable', detail, retry_after, code=f'http_{code}')
        return ProviderError('bad_request', detail, code=f'http_{code}')

    def _post_once(self, payload):
        try:
            response = requests.post(
                f"{settings.OLLAMA_BASE_URL.rstrip('/')}/api/chat",
                json=payload,
                timeout=settings.OLLAMA_CHAT_TIMEOUT,
            )
        except requests.Timeout as exc:
            raise ProviderError('unavailable', 'таймаут локальной модели', code='timeout') from exc
        except requests.RequestException as exc:
            raise ProviderError('unavailable', type(exc).__name__, code='connection_error') from exc

        if response.status_code >= 300:
            raise self._error_from(response)
        try:
            return response.json()
        except ValueError as exc:
            raise ProviderError('unavailable', 'некорректный ответ Ollama', code='malformed_json') from exc

    def chat(
        self,
        messages,
        temperature=0.2,
        max_tokens=900,
        json_mode=False,
        think=False,
        format_schema=None,
    ):
        if not self.can_chat():
            raise ProviderError('unsupported', 'не настроена')
        payload = {
            'model': self.model,
            'messages': messages,
            'stream': False,
            'think': think,
            'keep_alive': settings.OLLAMA_KEEP_ALIVE,
            'options': {
                'temperature': temperature,
                'num_predict': max_tokens,
                'num_ctx': settings.OLLAMA_NUM_CTX,
            },
        }
        if format_schema is not None:
            payload['format'] = format_schema
        elif json_mode:
            payload['format'] = 'json'

        attempts = max(1, settings.OLLAMA_CHAT_RETRIES + 1)
        last_error = None
        for attempt in range(attempts):
            started = time.monotonic()
            try:
                data = self._post_once(payload)
            except ProviderError as error:
                duration_ms = round((time.monotonic() - started) * 1000)
                if error.code in ('connection_error',):
                    stage = 'connection'
                elif error.code in ('malformed_json',):
                    stage = 'response_decode'
                elif error.code.startswith('http_') or error.code in (
                    'model_not_found', 'http_bad_request', 'http_auth_error',
                ):
                    stage = 'http_response'
                else:
                    stage = 'request'
                log.warning(
                    'provider=%s op=chat stage=%s attempt=%s/%s duration_ms=%s code=%s',
                    self.name,
                    stage,
                    attempt + 1,
                    attempts,
                    duration_ms,
                    error.code,
                )
                last_error = error
                if error.kind != 'unavailable' or attempt + 1 >= attempts:
                    raise
                time.sleep(settings.OLLAMA_RETRY_BACKOFF)
                continue

            duration_ms = round((time.monotonic() - started) * 1000)
            message = data.get('message') if isinstance(data, dict) else None
            if not isinstance(message, dict):
                log.warning(
                    'provider=%s op=chat stage=response_validation attempt=%s/%s duration_ms=%s code=invalid_response_shape',
                    self.name,
                    attempt + 1,
                    attempts,
                    duration_ms,
                )
                raise ProviderError(
                    'bad_request',
                    'некорректная структура ответа Ollama',
                    code='invalid_response_shape',
                )
            content = message.get('content')
            if not isinstance(content, str) or not content.strip():
                log.warning(
                    'provider=%s op=chat stage=response_validation attempt=%s/%s duration_ms=%s code=empty_response',
                    self.name,
                    attempt + 1,
                    attempts,
                    duration_ms,
                )
                raise ProviderError('bad_request', 'пустой ответ', code='empty_response')
            log.info(
                'provider=%s op=chat stage=complete attempt=%s/%s duration_ms=%s code=ok',
                self.name,
                attempt + 1,
                attempts,
                duration_ms,
            )
            return content.strip()
        raise last_error or ProviderError('unavailable', 'локальная модель недоступна')
