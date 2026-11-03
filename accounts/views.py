from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from django.contrib.auth import get_user_model

from projects.access import is_admin, can_browse_users
from .serializers import UserSerializer, UserCreateSerializer, ChangePasswordSerializer

User = get_user_model()


class UserViewSet(viewsets.ModelViewSet):
    queryset = User.objects.all().order_by('id')
    permission_classes = [IsAuthenticated]

    def get_serializer_class(self):
        if self.action == 'create':
            return UserCreateSerializer
        return UserSerializer

    def get_queryset(self):
        qs = super().get_queryset()
        if can_browse_users(self.request.user):
            return qs
        # Исполнитель видит только собственную учётную запись
        return qs.filter(id=self.request.user.id)

    def perform_create(self, serializer):
        if not is_admin(self.request.user):
            raise PermissionDenied("Только администратор может создавать пользователей.")
        serializer.save()

    def perform_update(self, serializer):
        user = self.request.user
        # Свой профиль можно править (role / is_active для не-админа read-only в сериализаторе)
        if not is_admin(user) and serializer.instance.id != user.id:
            raise PermissionDenied("Только администратор может изменять других пользователей.")
        serializer.save()

    def perform_destroy(self, instance):
        if not is_admin(self.request.user):
            raise PermissionDenied("Только администратор может удалять пользователей.")
        if instance.id == self.request.user.id:
            raise PermissionDenied("Нельзя удалить собственную учётную запись.")
        instance.delete()

    @action(detail=False, methods=['get', 'patch'], url_path='me')
    def me(self, request):
        if request.method == 'GET':
            serializer = UserSerializer(request.user, context={'request': request})
            return Response(serializer.data)
        serializer = UserSerializer(request.user, data=request.data, partial=True, context={'request': request})
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)

    @action(detail=False, methods=['post'], url_path='change-password')
    def change_password(self, request):
        serializer = ChangePasswordSerializer(data=request.data, context={'request': request})
        serializer.is_valid(raise_exception=True)
        request.user.set_password(serializer.validated_data['new_password'])
        request.user.save()
        # Смена пароля завершает все прежние сессии: украденный токен перестаёт работать.
        # Текущей сессии сразу выдаётся новая пара токенов.
        from rest_framework_simplejwt.tokens import RefreshToken
        from .auth_views import revoke_all_tokens, security_log
        revoke_all_tokens(request.user)
        refresh = RefreshToken.for_user(request.user)
        security_log.info('password_changed user=%r', request.user.username)
        return Response({
            'detail': 'Пароль изменён. Остальные сессии завершены.',
            'access': str(refresh.access_token), 'refresh': str(refresh),
        })
