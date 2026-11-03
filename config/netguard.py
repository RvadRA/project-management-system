"""
Защита от SSRF: исходящие запросы по адресам, которые задают пользователи
(вебхуки задач-интеграций), не должны попадать во внутреннюю сеть сервера.
"""
import ipaddress
import socket
from urllib.parse import urlsplit

from django.conf import settings


class UnsafeURL(ValueError):
    pass


def _is_internal(ip: str) -> bool:
    addr = ipaddress.ip_address(ip)
    return (
        addr.is_private or addr.is_loopback or addr.is_link_local or addr.is_multicast
        or addr.is_reserved or addr.is_unspecified
        # метаданные облаков и «общее адресное пространство» провайдеров
        or addr in ipaddress.ip_network('100.64.0.0/10')
    )


def assert_public_url(url: str) -> str:
    """
    Проверяет, что URL — http(s) и ведёт на внешний адрес. Внутренние адреса (localhost, 10.x,
    192.168.x, 169.254.169.254 и т. п.) разрешены, только если хост указан в INTEGRATION_ALLOWED_HOSTS.
    """
    parts = urlsplit(str(url or '').strip())
    if parts.scheme not in ('http', 'https'):
        raise UnsafeURL('Разрешены только адреса http:// и https://.')
    if parts.username or parts.password:
        raise UnsafeURL('Адрес не должен содержать логин и пароль.')
    host = (parts.hostname or '').lower()
    if not host:
        raise UnsafeURL('В адресе не указан сервер.')
    if host in {h.lower() for h in getattr(settings, 'INTEGRATION_ALLOWED_HOSTS', [])}:
        return url
    try:
        infos = socket.getaddrinfo(host, parts.port or (443 if parts.scheme == 'https' else 80), proto=socket.IPPROTO_TCP)
    except socket.gaierror:
        raise UnsafeURL('Не удалось определить адрес сервера.')
    for info in infos:
        if _is_internal(info[4][0]):
            raise UnsafeURL('Адрес ведёт во внутреннюю сеть — такие запросы запрещены.')
    return url
