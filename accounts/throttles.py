"""Ограничение попыток входа: защита от перебора паролей."""
from django.conf import settings
from rest_framework.throttling import SimpleRateThrottle


class _LoginThrottle(SimpleRateThrottle):
    setting_name = ''

    def get_rate(self):
        # Читаем лимит при каждом запросе, чтобы его можно было менять настройкой без перезапуска кода
        return getattr(settings, self.setting_name, None)


class LoginIPThrottle(_LoginThrottle):
    """Не больше N попыток входа с одного адреса."""
    scope = 'login_ip'
    setting_name = 'LOGIN_THROTTLE_PER_IP'

    def get_cache_key(self, request, view):
        return self.cache_format % {'scope': self.scope, 'ident': self.get_ident(request)}


class LoginUserThrottle(_LoginThrottle):
    """Не больше N попыток входа в одну учётную запись — с какого бы адреса ни шли запросы."""
    scope = 'login_user'
    setting_name = 'LOGIN_THROTTLE_PER_USER'

    def get_cache_key(self, request, view):
        username = str(request.data.get('username') or '').strip().lower()[:150]
        if not username:
            return None
        return self.cache_format % {'scope': self.scope, 'ident': username}
