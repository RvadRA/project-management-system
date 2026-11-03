from django.contrib import admin
from django.urls import path, include
from django.conf import settings
from django.conf.urls.static import static
from rest_framework_simplejwt.views import (
    TokenRefreshView,
    TokenVerifyView,
)

from accounts.auth_views import LoginView, LogoutView

urlpatterns = [
    path('admin/', admin.site.urls),

    # JWT Auth
    path('api/auth/token/', LoginView.as_view(), name='token_obtain_pair'),
    path('api/auth/token/refresh/', TokenRefreshView.as_view(), name='token_refresh'),
    path('api/auth/token/verify/', TokenVerifyView.as_view(), name='token_verify'),
    path('api/auth/logout/', LogoutView.as_view(), name='logout'),

    # Users
    path('api/users/', include('accounts.urls')),

    # Employees (served by matching app)
    path('api/employees/', include('matching.employee_urls')),

    # Projects
    path('api/projects/', include('projects.urls')),

    # Matching
    path('api/matching/', include('matching.urls')),

    # Workflows
    path('api/workflows/', include('workflows.urls')),

    # Notifications
    path('api/notifications/', include('notifications.urls')),

    # Planning & WBS
    path('api/planning/', include('plans.urls')),

    # ИИ-ассистент
    path('api/ai/', include('assistant.urls')),
]

# Напрямую отдаются только аватары. Файлы проектов, базы знаний и вложения задач доступны
# исключительно через API с проверкой прав (…/download/): прямая ссылка /media/… их не откроет.
# На боевом сервере то же правило задаётся в nginx: location только для /media/avatars/.
if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL + 'avatars/', document_root=settings.MEDIA_ROOT / 'avatars')
