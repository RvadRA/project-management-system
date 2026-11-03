"""Вход, обновление токена и выход."""
import logging

from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.token_blacklist.models import BlacklistedToken, OutstandingToken
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.views import TokenObtainPairView

from .throttles import LoginIPThrottle, LoginUserThrottle

security_log = logging.getLogger('security')


def client_ip(request):
    return LoginIPThrottle().get_ident(request)


def revoke_all_tokens(user):
    """Аннулирует все refresh-токены пользователя (выход со всех устройств)."""
    for token in OutstandingToken.objects.filter(user=user):
        BlacklistedToken.objects.get_or_create(token=token)


class LoginView(TokenObtainPairView):
    """Вход по логину и паролю. Попытки ограничены по адресу и по учётной записи."""
    throttle_classes = [LoginIPThrottle, LoginUserThrottle]

    def post(self, request, *args, **kwargs):
        username = str(request.data.get('username') or '')[:150]
        try:
            response = super().post(request, *args, **kwargs)
        except Exception:
            security_log.warning('login_failed user=%r ip=%s', username, client_ip(request))
            raise
        security_log.info('login_ok user=%r ip=%s', username, client_ip(request))
        return response

    def throttled(self, request, wait):
        security_log.warning(
            'login_throttled user=%r ip=%s wait=%ss',
            str(request.data.get('username') or '')[:150], client_ip(request), round(wait or 0),
        )
        super().throttled(request, wait)


class LogoutView(APIView):
    """Выход: refresh-токен аннулируется, обновить по нему сессию больше нельзя."""
    permission_classes = [IsAuthenticated]

    def post(self, request):
        raw = request.data.get('refresh')
        if raw:
            try:
                token = RefreshToken(raw)
                # Аннулировать можно только собственный токен
                if str(token.get('user_id')) == str(request.user.id):
                    token.blacklist()
            except TokenError:
                pass   # токен уже недействителен — цель достигнута
        if request.data.get('all_devices'):
            revoke_all_tokens(request.user)
        return Response(status=status.HTTP_205_RESET_CONTENT)
